import { join, resolve } from 'path'

import { compareScreenshots } from '../../../screenshot-utils'
import { findPort, killServer, startServer } from '../../../test-utils'

describe('SASS', () => {
  let serverHandle
  let port

  beforeAll(async () => {
    port = await findPort()
    serverHandle = await startServer(resolve(__dirname, '..'), port)
  })

  afterAll(async () => {
    await killServer(serverHandle)
  })

  it('should render the sass css', async () => {
    await page.goto(`http://localhost:${port}/`)

    await expect(page.content()).resolves.toMatch('Hello sass!')

    const screenshotData = await page.screenshot({ encoding: 'binary' })

    await compareScreenshots(
      screenshotData,
      join(__dirname, '__screenshots__/render.png')
    )
  })
})
