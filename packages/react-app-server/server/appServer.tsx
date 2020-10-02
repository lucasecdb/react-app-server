import * as fs from 'fs'
import { IncomingMessage, ServerResponse } from 'http'
import * as path from 'path'
import { parse as parseUrl } from 'url'

import React from 'react'
import { renderToNodeStream } from 'react-dom/server'
import { useRoutes } from 'react-router'

import Document from '../components/Document'
import {
  ASSET_MANIFEST_FILE,
  COMPONENTS_MANIFEST_FILE,
} from '../config/constants'
import { appDist, appDistPublic, appDistServer } from '../config/paths'
import matchRoute from './matchRoute'
import { serveStatic } from './serveStatic'
import { interopDefault, renderToHTML } from './utils'

const readJSON = (filePath: string) => {
  const file = fs.readFileSync(filePath)
  return JSON.parse(file.toString())
}

const ERROR_COMPONENT_NAME = 'error'

const resolveErrorComponent = async (entrypoint: string, props = {}) => {
  const componentPath = path.join(appDistServer, entrypoint)

  const Component = (await import(componentPath).then(
    interopDefault
  )) as React.ComponentType

  return <Component {...props} />
}

export class AppServer {
  private assetManifest
  private componentsManifest

  constructor() {
    const assetManifest = readJSON(path.join(appDist, ASSET_MANIFEST_FILE))

    const componentsManifest = readJSON(
      path.join(appDistServer, COMPONENTS_MANIFEST_FILE)
    )

    this.assetManifest = assetManifest
    this.componentsManifest = componentsManifest
  }

  public getRequestHandler() {
    return this.handleRequest.bind(this)
  }

  protected async handleRequest(req: IncomingMessage, res: ServerResponse) {
    res.statusCode = 200

    console.log('handling request for', req.url)

    let shouldContinue = true

    const matches = [
      matchRoute<{ path: string }>({
        route: '/:path*',
        fn: async (req, res, params) => {
          try {
            await serveStatic(
              req,
              res,
              path.join(appDistPublic, ...(params.path || []))
            )
            shouldContinue = false
          } catch (err) {
            if (err.code === 'ENOENT') {
              return
            }

            throw err
          }
        },
      }),
      matchRoute<{ path: string }>({
        route: '/static/:path*',
        fn: async (req, res, params) => {
          try {
            await serveStatic(
              req,
              res,
              path.join(appDist, 'static', ...(params.path || []))
            )
          } catch {
            res.statusCode = 404
          } finally {
            shouldContinue = false
          }
        },
      }),
    ]

    for (const routeMatch of matches) {
      // eslint-disable-next-line no-await-in-loop
      await routeMatch(req, res)

      if (!shouldContinue) {
        break
      }
    }

    if (!shouldContinue) {
      return
    }

    try {
      await this.renderDocument(req, res)
    } catch (err) {
      console.error(err)
      await this.renderError(req, res, err)
    }
  }

  private renderError = async (
    _: IncomingMessage,
    res: ServerResponse,
    err: Error
  ) => {
    const errorComponentEntrypoint = this.componentsManifest[
      ERROR_COMPONENT_NAME
    ]

    const assets: string[] = this.assetManifest.components[ERROR_COMPONENT_NAME]

    const scriptAssets = assets.filter((path) => path.endsWith('.js'))
    const styleAssets = assets.filter((path) => path.endsWith('.css'))

    const props = {
      error: { name: err.name, message: err.message, stack: err.stack },
    }

    const { head, markup } = await renderToHTML(
      await resolveErrorComponent(errorComponentEntrypoint, props)
    )

    res.setHeader('x-robots-tag', 'noindex, nofollow')
    res.setHeader('cache-control', 'no-cache')

    res.statusCode = 500

    res.write('<!doctype html>')

    renderToNodeStream(
      <Document
        markup={markup}
        head={head}
        scripts={scriptAssets}
        styles={styleAssets}
        componentName={ERROR_COMPONENT_NAME}
        componentProps={props}
      />
    ).pipe(res)
  }

  private renderDocument = async (
    req: IncomingMessage,
    res: ServerResponse
  ) => {
    const renderClient =
      new URLSearchParams(parseUrl(req.url!).search ?? undefined).has(
        'nossr'
      ) && process.env.NODE_ENV !== 'production'

    const { assetManifest, componentsManifest } = this
    const assets: string[] = assetManifest.components['index']

    const routesEntrypoint = componentsManifest['routes']
    const routesPath = path.join(appDistServer, routesEntrypoint)
    const appRoutes = await import(routesPath).then(interopDefault)

    const scriptAssets = assets.filter((path) => path.endsWith('.js'))
    const styleAssets = assets.filter((path) => path.endsWith('.css'))

    // const language = req.language

    res.setHeader('Content-Type', 'text/html')

    if (renderClient) {
      res.write('<!doctype html>')
      renderToNodeStream(
        <Document
          scripts={scriptAssets}
          styles={styleAssets}
          componentName="index"
        />
      ).pipe(res)
    } else {
      const Root = () => {
        const element = useRoutes(appRoutes)
        return element
      }
      const { head, routerContext, markup, state } = await renderToHTML(
        <Root />,
        req.url ?? '/'
      )

      if (routerContext.url) {
        res.statusCode = 302
        res.setHeader('location', routerContext.url)
      } else {
        res.statusCode = 200
        res.write('<!doctype html>')
        renderToNodeStream(
          <Document
            markup={markup}
            state={state}
            head={head}
            scripts={scriptAssets}
            styles={styleAssets}
            componentName="index"
          />
        ).pipe(res)
      }
    }
  }
}
