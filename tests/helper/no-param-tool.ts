import {
    PartialToolResult,
    ResultStatus,
    Tool,
    ToolParameters
} from '@johannes.latzel/llm-chat';

export class NoParamTool extends Tool {
    constructor() {
        super(
            'no-param',
            'A tool with no parameters.',
            new ToolParameters({})
        );
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        return {
            result: 'done',
            status: ResultStatus.Success
        };
    }
}
