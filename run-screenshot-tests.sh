#!/bin/bash

yarn install

yarn lerna bootstrap
yarn lerna run --concurrency 1 build
yarn lerna exec 'yarn link'
yarn --silent lerna ls | xargs yarn link

yarn test --rootDir test/screenshots
