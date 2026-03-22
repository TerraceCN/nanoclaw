import * as Lark from '@larksuiteoapi/node-sdk';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface FeishuChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class FeishuChannel implements Channel {
  name = 'feishu';

  private client: Lark.Client | null = null;
  private wsClient: Lark.WSClient | null = null;

  private opts: FeishuChannelOpts;
  private appId: string;
  private appSecret: string;

  constructor(appId: string, appSecret: string, opts: FeishuChannelOpts) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    const baseConfig = {
      appId: this.appId,
      appSecret: this.appSecret,
    };

    this.client = new Lark.Client(baseConfig);

    this.wsClient = new Lark.WSClient({
      ...baseConfig,
      loggerLevel: Lark.LoggerLevel.debug,
    });

    this.wsClient.start({
      eventDispatcher: new Lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data) => {
          await this.handleMessageEvent(data);
        },
      }),
    });

    logger.info('Feishu bot connected via WebSocket');

    return Promise.resolve();
  }

  private async handleMessageEvent(data: any): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { sender, message } = data as any;

    // Skip our own messages
    if (sender.sender_type === 'user' && !sender.sender_id?.open_id) {
      return;
    }

    const chatJid = `fs:${message.chat_id}`;
    const openId =
      sender.sender_id?.open_id || sender.sender_id?.user_id || 'unknown';
    const senderName = openId;
    const create_time = new Date(parseInt(message.create_time));
    const timestamp = create_time.toISOString();
    const msgId = message.message_id;
    const isGroup = message.chat_type === 'group';

    // Parse message content based on type
    let content = '';
    try {
      const parsed = JSON.parse(message.content);
      if (message.message_type === 'text') {
        content = parsed.text;
      } else if (message.message_type === 'post') {
        content = this.extractPostContent(parsed.post);
      }
    } catch {
      content = message.content;
    }

    if (!content) return;

    // Translate @bot mentions into TRIGGER_PATTERN format
    if (content.includes('<at ')) {
      content = content.replace(/<at[^>]*>.*?<\/at>/g, '').trim();
      if (!TRIGGER_PATTERN.test(content)) {
        content = `@${ASSISTANT_NAME} ${content}`;
      }
    }

    // Store chat metadata
    this.opts.onChatMetadata(
      chatJid,
      timestamp,
      `Feishu ${message.chat_id}`,
      'feishu',
      isGroup,
    );

    // Only deliver full message for registered groups
    const group = this.opts.registeredGroups()[chatJid];
    if (!group) {
      logger.debug({ chatJid }, 'Message from unregistered Feishu channel');
      return;
    }

    // Deliver message
    this.opts.onMessage(chatJid, {
      id: msgId,
      chat_jid: chatJid,
      sender: openId,
      sender_name: senderName,
      content,
      timestamp,
      is_from_me: false,
    });

    // React with emoji immediately
    this.reactToMessage(msgId, message.chat_id).catch((err) => {
      logger.error({ msgId, err }, 'Failed to react to message');
    });

    logger.info({ chatJid, sender }, 'Feishu message received via WS');
  }

  private async reactToMessage(
    messageId: string,
    chatId: string,
  ): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.im.v1.messageReaction.create({
        path: {
          message_id: messageId,
        },
        data: {
          reaction_type: {
            emoji_type: 'OneSecond',
          },
        },
      });
      logger.debug({ messageId }, 'Reacted to Feishu message');
    } catch (err) {
      logger.error({ messageId, err }, 'Failed to create message reaction');
    }
  }

  private extractPostContent(post: Record<string, unknown>): string {
    const contents =
      (post.content as Array<Array<Record<string, unknown>>>) || [];
    const textParts: string[] = [];

    if (post.title) {
      textParts.push(`# ${post.title} #`);
    }
    for (const line of contents) {
      const lineContent: string[] = [];
      for (const item of line) {
        let content: string;
        if (item.tag === 'text') {
          content = item.text as string;
        } else if (item.tag === 'a') {
          content = `[${item.text}]{${item.href}}`;
        } else if (item.tag === 'emotion') {
          content = item.emoji_type as string;
        } else if (item.tag === 'code_block') {
          content = '```' + (item.language || '') + '\n' + item.text + '\n```';
        } else if (item.tag === 'hr') {
          content = '-----';
        } else {
          continue;
        }
        lineContent.push(content || '');
      }
      textParts.push(lineContent.join(''));
    }

    return textParts.join('\n');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.client) {
      logger.warn('Feishu client not initialized');
      return;
    }

    try {
      const chatId = jid.replace(/^fs:/, '');

      // Split long messages (Feishu limit is 4000 chars for text)
      const MAX_LENGTH = 4000;
      const messages =
        text.length > MAX_LENGTH ? [text.slice(0, MAX_LENGTH)] : [text];

      for (const message of messages) {
        await this.client.im.v1.message.create({
          params: {
            receive_id_type: 'chat_id',
          },
          data: {
            receive_id: chatId,
            content: JSON.stringify({ text: message }),
            msg_type: 'text',
          },
        });
      }

      logger.info({ jid, length: text.length }, 'Feishu message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Feishu message');
    }
  }

  isConnected(): boolean {
    return this.wsClient !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('fs:');
  }

  async disconnect(): Promise<void> {
    this.wsClient = null;
    this.client = null;
    logger.info('Feishu bot stopped');
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    // Feishu doesn't support typing indicators via API
  }
}

registerChannel('feishu', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['FEISHU_APP_ID', 'FEISHU_APP_SECRET']);
  const appId = process.env.FEISHU_APP_ID || envVars.FEISHU_APP_ID || '';
  const appSecret =
    process.env.FEISHU_APP_SECRET || envVars.FEISHU_APP_SECRET || '';

  if (!appId || !appSecret) {
    logger.warn('Feishu: FEISHU_APP_ID or FEISHU_APP_SECRET not set');
    return null;
  }

  return new FeishuChannel(appId, appSecret, opts);
});
