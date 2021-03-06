import * as path from 'path'

import createStore from 'unistore'
import type { Compiler } from 'webpack'

import { paths } from '..'
import type { WebpackError } from '../build/utils'
import type { LoggerStoreStatus } from './logger'
import { logStore } from './logger'

interface CompilerDiagnostics {
  errors: WebpackError[] | null
  warnings: WebpackError[] | null
  buildDuration: number
}

type WebpackStatus =
  | { loading: true; fileName?: string }
  | ({
      loading: false
      typeChecking: boolean
    } & CompilerDiagnostics)

interface BuildStatusStore {
  client: WebpackStatus
  server: WebpackStatus
}

enum WebpackStatusPhase {
  COMPILING = 1,
  COMPILED_WITH_ERRORS = 2,
  COMPILED_WITH_WARNINGS = 4,
  COMPILED = 5,
}

function getWebpackStatusPhase(status: WebpackStatus): WebpackStatusPhase {
  if (status.loading === true) {
    return WebpackStatusPhase.COMPILING
  } else if (status.errors) {
    return WebpackStatusPhase.COMPILED_WITH_ERRORS
  } else if (status.warnings) {
    return WebpackStatusPhase.COMPILED_WITH_WARNINGS
  }
  return WebpackStatusPhase.COMPILED
}

const buildStore = createStore<BuildStatusStore>()

buildStore.subscribe((state) => {
  const { client, server } = state

  const [{ status }] = [
    { status: client, phase: getWebpackStatusPhase(client) },
    { status: server, phase: getWebpackStatusPhase(server) },
  ].sort((a, b) => a.phase.valueOf() - b.phase.valueOf())

  const { bootstrap: bootstrapping, port } = logStore.getState()
  if (bootstrapping && status.loading) {
    return
  }

  let nextState: LoggerStoreStatus

  if (status.loading === true) {
    nextState = {
      bootstrap: false,
      loading: true,
      port,
      fileName: status.fileName,
    }
  } else {
    const { errors, warnings, typeChecking, buildDuration } = status

    if (errors == null && typeChecking) {
      nextState = {
        bootstrap: false,
        port,
        typeChecking: true,
        loading: false,
        errors,
        warnings,
        buildDuration,
      }
    } else {
      nextState = {
        bootstrap: false,
        port,
        loading: false,
        typeChecking: false,
        errors,
        warnings,
        buildDuration,
      }
    }
  }

  logStore.setState(nextState, true)
})

export function watchCompilers(
  client: Compiler,
  server: Compiler,
  hasTypeChecking: boolean
) {
  buildStore.setState({
    client: { loading: true },
    server: { loading: true },
  })

  function tapCompiler(
    key: string,
    compiler: Compiler,
    enableTypecheck: boolean,
    onEvent: (status: WebpackStatus) => void
  ) {
    compiler.hooks.invalid.tap(
      `BuildInvalid-${key}`,
      (fileName: string | null) => {
        onEvent({
          loading: true,
          fileName: fileName
            ? path.relative(path.join(paths.appPath), fileName)
            : undefined,
        })
      }
    )

    compiler.hooks.done.tap(`BuildDone-${key}`, (stats) => {
      const { errors, warnings } = stats.toJson({
        all: false,
        warnings: true,
        errors: true,
      })

      const hasErrors = !!errors?.length
      const hasWarnings = !!warnings?.length

      const buildDuration = (stats.endTime - stats.startTime) / 1000

      onEvent({
        loading: false,
        errors: hasErrors ? errors ?? null : null,
        warnings: hasWarnings ? warnings ?? null : null,
        typeChecking: enableTypecheck,
        buildDuration,
      })
    })
  }

  tapCompiler('client', client, hasTypeChecking, (status) =>
    buildStore.setState({ client: status })
  )
  tapCompiler('server', server, false, (status) =>
    buildStore.setState({ server: status })
  )
}
