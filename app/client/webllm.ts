import { createContext } from "react";
import {
  CreateWebServiceWorkerEngine,
  InitProgressReport,
  prebuiltAppConfig,
  ChatCompletionMessageParam,
  WebServiceWorkerEngine,
} from "@neet-nestor/web-llm";

import { ChatOptions, LLMApi, LLMConfig } from "./api";

export class WebLLMApi implements LLMApi {
  private currentModel?: string;
  private engine?: WebServiceWorkerEngine;

  constructor(onEngineCrash: () => void) {
    setInterval(() => {
      if ((this.engine?.missedHeatbeat || 0) > 2) {
        onEngineCrash?.();
      }
    }, 10000);
  }

  clear() {
    this.engine = undefined;
  }

  async initModel(
    config: LLMConfig,
    onUpdate?: (message: string, chunk: string) => void,
  ) {
    this.currentModel = config.model;
    this.engine = await CreateWebServiceWorkerEngine(config.model, {
      chatOpts: {
        temperature: config.temperature,
        top_p: config.top_p,
        presence_penalty: config.presence_penalty,
        frequency_penalty: config.frequency_penalty,
      },
      appConfig: {
        ...prebuiltAppConfig,
        useIndexedDBCache: config.cache === "index_db",
      },
      initProgressCallback: (report: InitProgressReport) => {
        onUpdate?.(report.text, report.text);
      },
    });
  }

  async chat(options: ChatOptions): Promise<void> {
    if (options.config.model !== this.currentModel) {
      try {
        await this.initModel(options.config, options.onUpdate);
      } catch (e) {
        console.error("Error in initModel", e);
      }
    }

    let reply: string | null = "";
    if (options.config.stream) {
      try {
        const asyncChunkGenerator = await this.engine!.chatCompletion({
          stream: options.config.stream,
          messages: options.messages as ChatCompletionMessageParam[],
        });

        for await (const chunk of asyncChunkGenerator) {
          if (chunk.choices[0].delta.content) {
            reply += chunk.choices[0].delta.content;
            options.onUpdate?.(reply, chunk.choices[0].delta.content);
          }
        }
      } catch (err) {
        console.error("Error in streaming chatCompletion", err);
        options.onError?.(err as Error);
      }
    } else {
      try {
        const completion = await this.engine!.chatCompletion({
          stream: options.config.stream,
          messages: options.messages as ChatCompletionMessageParam[],
        });
        reply = completion.choices[0].message.content;
      } catch (err) {
        console.error("Error in non-streaming chatCompletion", err);
        options.onError?.(err as Error);
      }
    }

    if (reply) {
      options.onFinish(reply);
    } else {
      options.onError?.(new Error("Empty response generated by LLM"));
    }
  }

  async abort() {
    await this.engine?.interruptGenerate();
  }

  async usage() {
    return {
      used: 0,
      total: 0,
    };
  }

  async models() {
    return prebuiltAppConfig.model_list.map((record) => ({
      name: record.model_id,
      available: true,
      provider: {
        id: "huggingface",
        providerName: "huggingface",
        providerType: "huggingface",
      },
    }));
  }
}

export const WebLLMContext = createContext<WebLLMApi | null>(null);
