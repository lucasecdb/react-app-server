import * as fs from 'fs'
import * as path from 'path'
import { parse as parseUrl } from 'url'

import type { RootContext } from '@casterly/components'
import { constants, paths } from '@casterly/utils'
import type { RoutesManifest } from 'casterly'
import fresh from 'fresh'

import type { Request } from '../fetch'
import { Headers, Response } from '../fetch'
import { MAX_AGE_LONG } from '../utils/maxAge'
import { getMatchedRoutes } from '../utils/routes'
import matchRoute from './matchRoute'
import type { ResponseObject } from './response'
import { serveStatic } from './serveStatic'
import {
  interopDefault,
  isPreconditionFailure,
  readJSON,
  requestContainsPrecondition,
  requestHeadersToNodeHeaders,
} from './utils'

const {
  BUILD_ID_FILE,
  ROUTES_MANIFEST_FILE,
  STATIC_ENTRYPOINTS_ROUTES,
  STATIC_RUNTIME_MAIN,
} = constants

interface ServerContext extends RootContext {
  routeHeaders: Headers
}

export interface ServerOptions {
  dev?: boolean
}

class DefaultServer {
  private _routesManifest
  private dev

  constructor(opts: ServerOptions = {}) {
    const { dev = false } = opts

    if (!dev) {
      this._routesManifest = readJSON(
        path.join(paths.appBuildFolder, ROUTES_MANIFEST_FILE)
      )
    }

    this.dev = dev
  }

  public getRequestHandler() {
    return this.handleRequest.bind(this)
  }

  protected async getBuildId(): Promise<string | null> {
    const fileContent = await fs.promises.readFile(
      path.join(paths.appBuildFolder, BUILD_ID_FILE)
    )

    return fileContent.toString()
  }

  protected async handleRequest(
    req: Request,
    responseHeaders?: Headers,
    adapterOptions?: any
  ): Promise<ResponseObject> {
    if (
      responseHeaders !== undefined &&
      !(responseHeaders instanceof Headers)
    ) {
      console.warn(
        'handleRequest did not receive a Headers instance for its second argument.'
      )
      responseHeaders = new Headers()
    }

    const matches = [
      matchRoute<{ path: string }>({
        route: '/:path*',
        fn: async (req, _, url) => {
          try {
            return await serveStatic(
              req,
              path.join(paths.appPublicBuildFolder, url.pathname!),
              !this.dev
            )
          } catch (err) {
            if (err.code === 'ENOENT') {
              return
            }

            throw err
          }
        },
      }),
      matchRoute({
        route: '/_casterly/route-manifest',
        fn: async (req, __, url) => {
          const query = url.query as { path?: string }

          const buildId = await this.getBuildId()

          const etag = this.dev ? '' : `W/"${buildId}"`

          let status = 200

          const headers: Record<string, string> = {}

          headers['content-type'] = 'application/json'

          if (!this.dev) {
            headers['etag'] = etag
            headers['cache-control'] = 'public, max-age=' + MAX_AGE_LONG
          }

          if (requestContainsPrecondition(req)) {
            if (isPreconditionFailure(req, new Headers({ etag }))) {
              return {
                status: 412,
                outgoingHeaders: headers,
              }
            }

            if (
              fresh(requestHeadersToNodeHeaders(req.headers), {
                etag,
              })
            ) {
              return {
                status: 304,
                outgoingHeaders: headers,
              }
            }
          }

          let body

          if (!query.path) {
            status = 400

            body = JSON.stringify({
              message: "Query parameter 'path' is required",
            })
          } else {
            const url = parseUrl(query.path)

            const { routes, routeHeaders, ...clientContext } =
              await this.getServerContextForRoute(url.pathname!)

            body = JSON.stringify(clientContext)
          }

          return {
            status,
            outgoingHeaders: headers,
            body,
          }
        },
      }),
      matchRoute<{ filePath: string }>({
        route: '/_casterly/static/:filePath*',
        fn: async (req, { filePath }) => {
          try {
            return await serveStatic(
              req,
              path.join(paths.appBuildFolder, 'static', ...filePath),
              !this.dev
            )
          } catch {
            return { status: 404 }
          }
        },
      }),
      matchRoute<{ filePath: string }>({
        route: '/_casterly/:path*',
        fn: async () => {
          return { status: 404, body: null }
        },
      }),
    ]

    for (const routeMatch of matches) {
      // eslint-disable-next-line no-await-in-loop
      const response = await routeMatch(req)

      if (response) {
        return response
      }
    }

    try {
      return await this.renderDocument(req, responseHeaders, adapterOptions)
    } catch (err) {
      console.error('[ERROR]:', err)
      return {
        status: 500,
        outgoingHeaders: {
          'x-robots-tag': 'noindex, nofollow',
        },
        body: 'error',
      }
    }
  }

  protected getRoutesManifestFile = (): RoutesManifest => this._routesManifest

  protected getDevServerPort(): undefined | number {
    return undefined
  }

  private getServerContextForRoute = async (url: string) => {
    const routesManifest = this.getRoutesManifestFile()

    const appRoutesModule = await import(
      path.join(paths.appServerBuildFolder, STATIC_ENTRYPOINTS_ROUTES)
    )

    const appRoutes = appRoutesModule.default || appRoutesModule

    const { routes, matchedRoutes, matchedRoutesAssets, routeHeaders } =
      await getMatchedRoutes({
        location: url,
        routesPromiseComponent: appRoutes,
        routesManifest,
      })

    const serverContext: ServerContext = {
      version: await this.getBuildId(),
      devServerPort: this.getDevServerPort(),
      routes,
      matchedRoutes: matchedRoutes.map((routeMatch) => {
        const {
          element,
          // @ts-ignore: the component prop is injected by the
          // webpack plugin via routes-manifest.json
          component,
          children,
          ...route
        } = routeMatch.route

        return {
          ...routeMatch,
          route: {
            ...route,
            element: null,
          },
        }
      }),
      matchedRoutesAssets,
      mainAssets: routesManifest.main,
      routeHeaders,
    }

    return serverContext
  }

  private getAppRequestHandler = async (): Promise<
    (
      req: Request,
      status: number,
      headers: Headers,
      context: unknown,
      adapterOptions?: any
    ) => Response | Promise<Response>
  > => {
    const handleRequest = await import(
      path.join(paths.appServerBuildFolder, STATIC_RUNTIME_MAIN)
    )
      // TypeScript will wrap the above import call with an __importStar
      // function, which will make the default exports the reference to the
      // actual module, so we must interop twice to get the actual
      // implementation
      .then(interopDefault)
      .then(interopDefault)

    return handleRequest
  }

  private renderDocument = async (
    request: Request,
    responseHeaders?: Headers,
    adapterOptions?: any
  ): Promise<ResponseObject> => {
    const headers = new Headers(responseHeaders)

    const serverContext = await this.getServerContextForRoute(request.url)

    serverContext.routeHeaders?.forEach((value, key) => {
      headers.set(key, value)
    })

    const handleRequest = await this.getAppRequestHandler()

    let status = 200

    let response = handleRequest(
      request,
      status,
      headers,
      serverContext,
      adapterOptions
    )

    if ('then' in response) {
      response = await response
    }

    let outgoingHeaders: Record<string, string> = {}
    let onReadyToStream = undefined

    let body = null

    if (response instanceof Response) {
      status = response.status
      outgoingHeaders = {}

      response.headers.forEach((value, key) => {
        outgoingHeaders[key] = value
      })

      body = response.body
    } else if (typeof response === 'string') {
      body = response
    } else if (typeof response === 'object') {
      const recordResponse = response as Record<string, any>

      status = recordResponse.status
      body = recordResponse.body
      outgoingHeaders = recordResponse.headers
      onReadyToStream = recordResponse.onReadyToStream
    }

    return { status, outgoingHeaders, body, onReadyToStream }
  }
}

export { DefaultServer as _private_DefaultServer }

export const createRequestHandler = () => {
  const serverInstance = new DefaultServer()

  return serverInstance.getRequestHandler()
}
