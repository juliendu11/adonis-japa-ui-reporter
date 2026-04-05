import {BaseReporter} from '@japa/runner/core'

import net from 'node:net'
import open from 'open';
import type {UIReporterOptions} from "./types.js";
import createServer from "./ui/server.js";

const DEFAULT_UI_PORT = 3000
const DEFAULT_REPORTER_PORT = 9999


export default class UIReporter extends BaseReporter {
    static name = 'ui'

    private client: net.Socket = new net.Socket()
    private options: UIReporterOptions
    private stopServer: (() => void) | null = null

    constructor(options?: UIReporterOptions) {
        super(options)
        this.options = options || {}
    }

    onTestStart() {
    }

    onTestEnd(testPayload: any) {
        const data = {
            title: testPayload.title.original,
            group: {title: testPayload.meta.group.title},
            hasError: testPayload.hasError,
            errors: testPayload.errors,
            duration: testPayload.duration,
            file: {
                name: testPayload.meta.fileName
            },
        }

        if (this.client) {
            this.client.write(JSON.stringify(data) + '\n')
        }
    }

    onGroupStart() {
    }

    onGroupEnd() {
    }

    onSuiteStart() {
    }

    onSuiteEnd() {
    }

    async start() {
        const uiPort = this.options?.ui?.port ?? DEFAULT_UI_PORT
        const reporterPort = this.options?.reporter?.port ?? DEFAULT_REPORTER_PORT

        const {stop, listeners} = createServer({
            ui: {port: uiPort},
            reporter: {port: reporterPort}
        })
        this.stopServer = stop

        listeners.onReady = async () => {
            await open("http://localhost:" + uiPort)
        }

        this.client.connect(reporterPort, '127.0.0.1', () => {
            if (this.client) {
                this.client.write('CLEAR\n')
            }
        })


        await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    async end() {
        if (this.client) {
            this.client.write('END\n')
            this.client.end()
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
        this.stopServer?.()
    }
}
