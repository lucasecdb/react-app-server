// @ts-ignore
import { promises as fsp } from 'fs'
import { dirname } from 'path'

import compareImages from 'resemblejs/compareImages'

const compareOptions = {
  output: {
    errorColor: {
      red: 255,
      green: 0,
      blue: 255,
      alpha: 150,
    },
    errorType: 'movementDifferenceIntensity',
    transparency: 0.3,
  },
  ignore: ['antialiasing'],
}

const NO_MATCH_DIRECTORY = 'no_match'

export async function compareScreenshots(
  screenshotData: Buffer,
  goldenPath: string
) {
  let golden: Buffer

  try {
    golden = await fsp.readFile(goldenPath)
  } catch {
    await fsp.mkdir(dirname(goldenPath), { recursive: true })
    await fsp.writeFile(goldenPath, screenshotData, { encoding: 'binary' })
    return
  }

  const data = await compareImages(screenshotData, golden, compareOptions)
  const diff = data.getBuffer()

  if (Number(data.misMatchPercentage) > 0) {
    await fsp.mkdir(dirname(`${NO_MATCH_DIRECTORY}/${goldenPath}`), {
      recursive: true,
    })
    await fsp.writeFile(`${NO_MATCH_DIRECTORY}/${goldenPath}`, diff)
  }

  expect(Number(data.misMatchPercentage)).toBe(0)
}
