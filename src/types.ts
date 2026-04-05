import {BaseReporterOptions} from "@japa/runner/types";

export type UIReporterOptions = BaseReporterOptions & {
    ui?: {
        port: number
    },
    reporter?: {
        port: number
    },
    killPortsInUse?: boolean
}

export type CreateServerOptions = {
    ui: {
        port: number
    },
    reporter: {
        port: number
    }
}