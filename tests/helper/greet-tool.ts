import {
    PartialToolResult,
    ResultStatus,
    Tool,
    ToolParameters,
    ToolParameterProperty
} from '@johannes.latzel/llm-chat';

export class GreetTool extends Tool {
    constructor() {
        super(
            'greet',
            'Greets a person by name. Returns a friendly greeting message.',
            new ToolParameters(
                {
                    name: ToolParameterProperty.string('The name of the person to greet.')
                },
                ['name']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        const name = args.name;
        if (typeof name !== 'string') {
            return { result: 'name must be a string.', status: ResultStatus.Error };
        }
        return {
            result: `Hello, ${name}!`,
            status: ResultStatus.Success
        };
    }
}
