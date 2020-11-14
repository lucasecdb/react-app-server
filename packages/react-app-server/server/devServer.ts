import * as path from 'path'

import { constants, paths } from '@app-server/cli'
// @ts-ignore
import fetch from 'make-fetch-happen'

import { _private_DefaultServer as DefaultServer } from './defaultServer'

class DevServer extends DefaultServer {
  constructor() {
    super({ dev: true })
  }

  protected getRoutesManifestFile = () => {
    return require(path.join(
      paths.appBuildFolder,
      constants.ROUTES_MANIFEST_FILE
    ))
  }

  protected getBuildId() {
    return Promise.resolve(undefined)
  }

  protected async handleRequest(req: Request) {
    try {
      await fetch('http://localhost:8081/server-ready')
    } catch {
      return new Response("The build server isn't running.", {
        status: 500,
      })
    }

    return super.handleRequest(req)
  }
}

export const createRequestHandler = () => {
  const serverInstance = new DevServer()

  return serverInstance.getRequestHandler()
}