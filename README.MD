[![NPM](https://nodei.co/npm/@juliendu11/japa-ui-reporter.png?compact=true)](https://npmjs.org/package/@juliendu11/japa-ui-reporter)

# Japa UI reporter

Frustrated by the various default reporting tools, I created my own.

This one allows you to open a dashboard in your browser with live reports of your tests, similar to `vitest --ui`

When the tests start, a page will open in your browser for live results. Then a report generated in end in
./test_results in your project. It's same page as the live one but in static

<img src="./resources/screenshot.png" alt="screenshot" width="600px">

## Installation

```bash
npm install -D @juliendu11/japa-ui-reporter
```

## Usage

:warning: Note: I use it with Adonis JS; it's designed to be used with **version 6**.

```ts
// tests/bootstrap.ts
import UIReporter from '@juliendu11/japa-ui-reporter'

import type {Config} from '@japa/runner/types'

export const reporters: Config['reporters'] = {
    activated: ['ui'],
    list: [UIReporter.ui()],
}
```

### Options

```ts
UIReporter.ui({
    ui: { // Optional, default: {port: 3000}
        port: number
    },
    reporter: { // Optional, default: {port: 9999}
        port: number
    },
    killPortsInUse: true,  // Optional, default: true
    livePreview: false,  // Optional, default: true
    ...BaseReporterOptions // Optional
})
```

## How it works

The reporter starts a server that hosts the dashboard and listens for test events from TCP. When a test event occurs, it
sends the data to the dashboard via WebSocket, which updates the user interface accordingly.

Then, at the end of the test run, the server creates a static HTML file, similar to the live version, containing the
test results. You will find the report in `./test_results` at the root of your project.

[More information here](./ARCHITECTURE.md)

## Problem

### Not receiving `END` instructions

I had this problem in my Adonis 6 project before even installing this reporter (the same issue occurred with Spec), even
though it worked fine initially.

I found a solution: in the runnerHooks, within the teardown hook, you need to explicitly tell the runner to call end().
This fixes the problem for all reporters.

```ts
// tests/bootstrap.ts
export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
    setup: [],
    teardown: [
        (e) => {  // FIX
            e.end()
        },
    ],
}
```