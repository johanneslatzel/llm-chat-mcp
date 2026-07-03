import {
    PartialToolResult,
    ResultStatus,
    Tool,
    ToolParameters,
    ToolParameterProperty
} from '@johannes.latzel/llm-chat';

export class ErrorTool extends Tool {
    constructor() {
        super(
            'error-tool',
            'A tool that always returns an error.',
            new ToolParameters(
                {
                    name: ToolParameterProperty.string('The name.')
                },
                ['name']
            )
        );
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        return {
            result: 'Something went wrong',
            status: ResultStatus.Error
        };
    }
}
