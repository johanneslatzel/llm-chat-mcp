import {
    Tool,
    ToolPackage,
    ToolParameters,
    ToolParameterProperty,
    PartialToolResult,
    ResultStatus
} from '@johannes.latzel/llm-chat';

/** Tool that returns a success result echoing the input argument. */
export class TestTool extends Tool {
    constructor(name: string) {
        super(
            name,
            `Tool ${name}`,
            new ToolParameters(
                {
                    input: ToolParameterProperty.string('Input value')
                },
                ['input']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        return {
            result: `executed ${this.name} with ${String(args.input)}`,
            status: ResultStatus.Success
        };
    }
}

/** Tool that always returns an error result. */
export class TestToolError extends Tool {
    constructor(name: string) {
        super(
            name,
            `Tool ${name}`,
            new ToolParameters(
                {
                    input: ToolParameterProperty.string('Input value')
                },
                ['input']
            )
        );
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        return {
            result: `error from ${this.name}`,
            status: ResultStatus.Error
        };
    }
}

/** A package bundling two {@link TestTool} instances. */
export class TestPackage extends ToolPackage {
    constructor() {
        super([new TestTool('pkg-tool-a'), new TestTool('pkg-tool-b')]);
    }
}

/** Tool that accepts a hidden `path` alias for its required `paths` array. */
export class AliasTool extends Tool {
    constructor() {
        super(
            'alias-tool',
            'Tool with a hidden path alias',
            new ToolParameters(
                {
                    paths: ToolParameterProperty.array('Paths').accepts('path')
                },
                ['paths']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        const paths = args.paths;
        if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) {
            return { result: 'paths must be a string array', status: ResultStatus.Error };
        }
        return { result: `paths: ${paths.join(',')}`, status: ResultStatus.Success };
    }
}
