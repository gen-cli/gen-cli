import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  Content,
  Part,
  ContentListUnion,
  PartUnion,
} from '@google/genai';
import OpenAI from 'openai';
import { ContentGenerator } from './contentGenerator.js';
import { jsonrepair } from 'jsonrepair';
const OPENAI_BASE_URL = 'https://api.siliconflow.cn';
import { reportError } from '../utils/errorReporting.js';

/**
 * Helper function to convert ContentListUnion to Content[]
 */
function toContents(contents: ContentListUnion): Content[] {
  if (Array.isArray(contents)) {
    // it's a Content[] or a PartUnion[]
    return contents.map(toContent);
  }
  // it's a Content or a PartUnion
  return [toContent(contents)];
}

function toContent(content: Content | PartUnion): Content {
  if (Array.isArray(content)) {
    // This shouldn't happen in our context, but handle it
    throw new Error('Array content not supported in this context');
  }
  if (typeof content === 'string') {
    // it's a string
    return {
      role: 'user',
      parts: [{ text: content }],
    };
  }
  if (typeof content === 'object' && content !== null && 'parts' in content) {
    // it's a Content
    return content;
  }
  // it's a Part
  return {
    role: 'user',
    parts: [content as Part],
  };
}

export class OpenAICompatibleContentGenerator implements ContentGenerator {
  private openai: OpenAI;

  constructor(apiKey: string, baseUrl: string = OPENAI_BASE_URL) {
    this.openai = new OpenAI({
      apiKey,
      baseURL: baseUrl,
    });
  }

  private convertToOpenAIMessages(
    contents: Content[],
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    for (const content of contents) {
      const role =
        content.role === 'model'
          ? 'assistant'
          : (content.role as 'system' | 'user');
      const parts = content.parts || [];
      const textParts = parts.filter(
        (part: Part): part is { text: string } =>
          typeof part === 'object' && part !== null && 'text' in part,
      );
      if (textParts.length > 0) {
        const combinedText = textParts
          .map((part: { text: string }) => part.text)
          .join('\n');
        messages.push({
          role,
          content: combinedText,
        });
      }

      const functionResponseParts = parts.filter(
        (
          part: Part,
        ): part is {
          functionResponse: {
            id: string;
            name: string;
            response: { output?: string; error?: string };
          };
        } =>
          typeof part === 'object' &&
          part !== null &&
          'functionResponse' in part &&
          part.functionResponse !== undefined &&
          typeof part.functionResponse.id === 'string' &&
          typeof part.functionResponse.name === 'string' &&
          part.functionResponse.response !== undefined &&
          (typeof part.functionResponse.response.output === 'string' ||
            typeof part.functionResponse.response.error === 'string'),
      );

      if (functionResponseParts.length > 0) {
        const combinedText = functionResponseParts
          .map((part) =>
            part.functionResponse.response.error
              ? `Error: ${part.functionResponse.response.error}`
              : part.functionResponse.response.output,
          )
          .join('\n');
        const tool_call_id = functionResponseParts[0].functionResponse.id;
        messages.push({
          tool_call_id,
          role: 'tool',
          content: combinedText,
        });
      }
      const functionCallParts = parts.filter(
        (
          part: Part,
        ): part is {
          functionCall: { name: string; args: Record<string, unknown> };
        } =>
          typeof part === 'object' &&
          part !== null &&
          'functionCall' in part &&
          part.functionCall !== undefined &&
          typeof part.functionCall.name === 'string' &&
          part.functionCall.args !== undefined,
      );

      if (functionCallParts.length > 0) {
        if (role === 'user') {
          throw new Error('Function calls cannot come from user role');
        }
        messages.push({
          role: 'assistant', // Force assistant role for tool calls
          content: null,
          tool_calls: functionCallParts.map((part) => ({
            id: `call_${Math.random().toString(36).slice(2)}`,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args),
            },
          })),
        });
      }

      if (
        textParts.length === 0 &&
        functionCallParts.length === 0 &&
        functionResponseParts.length === 0
      ) {
        throw new Error(
          `Content parts not processed: ${JSON.stringify(content, null, 2)}`,
        );
      }
    }

    return messages;
  }

  private convertToGeminiResponse(
    response: OpenAI.Chat.Completions.ChatCompletion,
  ): GenerateContentResponse {
    const choice = response.choices[0];
    if (!choice || (!choice.message.content && !choice.message.tool_calls)) {
      throw new Error('No valid choices in OpenAI response');
    }

    const geminiResponse = new GenerateContentResponse();

    if (choice.message.content) {
      geminiResponse.candidates = [
        {
          content: {
            parts: [{ text: choice.message.content }],
            role: 'model',
          },
          index: 0,
          safetyRatings: [],
        },
      ];
    } else if (choice.message.tool_calls) {
      geminiResponse.candidates = [
        {
          content: {
            parts: choice.message.tool_calls.map((toolCall) => ({
              functionCall: {
                name: toolCall.function.name,
                args: JSON.parse(jsonrepair(toolCall.function.arguments)),
              },
            })),
            role: 'model',
          },
          index: 0,
          safetyRatings: [],
        },
      ];
    }

    geminiResponse.usageMetadata = {
      promptTokenCount: response.usage?.prompt_tokens || 0,
      candidatesTokenCount: response.usage?.completion_tokens || 0,
      totalTokenCount: response.usage?.total_tokens || 0,
    };

    return geminiResponse;
  }
  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const contentsArray = toContents(request.contents);
    const messages = this.convertToOpenAIMessages(contentsArray);
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined =
      request.config?.tools?.flatMap((tool) => {
        if ('functionDeclarations' in tool) {
          return (
            tool.functionDeclarations?.map((func) => {
              if (!func.name) {
                throw new Error('Function declaration must have a name');
              }
              return {
                type: 'function',
                function: {
                  name: func.name,
                  description: func.description || '',
                  parameters:
                    (func.parameters as Record<string, unknown>) || {},
                },
              };
            }) || []
          );
        }
        return [];
      });

    let params = {
      model: request.model,
      messages,
      stream: true,
      temperature: request.config?.temperature,
      max_tokens: request.config?.maxOutputTokens,
      top_p: request.config?.topP,
      tools,
    };
    params = {
      ...params,
      top_p: 0.95,
      temperature: 0.6,
    };
    const stream = await this.openai.chat.completions.create({
      ...params,
      stream: true,
    });

    const toolCallMap = new Map<
      number,
      {
        name: string;
        arguments: string;
      }
    >();
    const generator =
      async function* (): AsyncGenerator<GenerateContentResponse> {
        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          if (choice?.delta?.content) {
            const geminiResponse = new GenerateContentResponse();
            geminiResponse.candidates = [
              {
                content: {
                  parts: [{ text: choice.delta.content }],
                  role: 'model',
                },
                index: 0,
                safetyRatings: [],
              },
            ];
            yield geminiResponse;
          }
          // Handle tool call deltas
          if (choice?.delta?.tool_calls) {
            for (const toolCall of choice.delta.tool_calls) {
              const idx = toolCall.index;
              const current = toolCallMap.get(idx) || {
                name: '',
                arguments: '',
              };

              // Update name if provided
              if (toolCall.function?.name) {
                current.name = toolCall.function.name;
              }

              // Accumulate arguments
              if (toolCall.function?.arguments) {
                current.arguments += toolCall.function.arguments;
              }

              toolCallMap.set(idx, current);
            }
          }

          const tryRepair = (str: string) => {
            try {
              return JSON.parse(jsonrepair(str));
            } catch (error) {
              reportError(
                error,
                'Error when talking to OpenAI-compatible API',
                { params, str },
                'OpenAICompatible.parseToolCallArguments',
              );
              throw error;
            }
          };
          // Flush completed tool calls on finish
          if (choice.finish_reason === 'tool_calls' && toolCallMap.size > 0) {
            const geminiResponse = new GenerateContentResponse();
            geminiResponse.candidates = [
              {
                content: {
                  parts: Array.from(toolCallMap.entries()).map(
                    ([_index, toolCall]) => ({
                      functionCall: {
                        name: toolCall.name,
                        args: toolCall.arguments
                          ? tryRepair(toolCall.arguments)
                          : {},
                      },
                    }),
                  ),
                  role: 'model',
                },
                index: 0,
                safetyRatings: [],
              },
            ];
            yield geminiResponse;
            toolCallMap.clear(); // Reset for next tool calls
          }

          if (choice?.finish_reason) {
            const geminiResponse = new GenerateContentResponse();
            geminiResponse.candidates = [
              {
                content: {
                  parts: [],
                  role: 'model',
                },
                index: 0,
                safetyRatings: [],
              },
            ];
            yield geminiResponse;
            return;
          }
        }
      };

    return generator();
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    const contentsArray = toContents(request.contents);
    const messages = this.convertToOpenAIMessages(contentsArray);

    const tools = undefined;

    const completion = await this.openai.chat.completions.create({
      model: request.model,
      messages,
      stream: false,
      temperature: request.config?.temperature,
      max_tokens: request.config?.maxOutputTokens,
      top_p: request.config?.topP,
      tools,
    });

    return this.convertToGeminiResponse(completion);
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    const contentsArray = toContents(request.contents);

    // We'll estimate based on the text length (rough approximation: 4 chars per token)
    const messages = this.convertToOpenAIMessages(contentsArray);
    const totalText = messages.map((m) => m.content).join(' ');
    const estimatedTokens = Math.ceil(totalText.length / 4);

    return {
      totalTokens: estimatedTokens,
    };
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw new Error('TODO: add support for embedding content');
  }
}
