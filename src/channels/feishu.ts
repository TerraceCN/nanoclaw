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

interface FeishuTableColumn {
  tag: 'column';
  name: string;
  display_name: string;
  width: string;
}

interface FeishuTableRow {
  [key: string]: string;
}

interface FeishuTableElement {
  tag: 'table';
  page_size: number;
  columns: FeishuTableColumn[];
  rows: FeishuTableRow[];
}

type FeishuElement =
  | FeishuTableElement
  | { tag: 'markdown'; content: string }
  | { tag: 'div'; text: { tag: 'lark_md'; content: string } };

type MessageFormat = 'text' | 'post' | 'interactive';

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
      loggerLevel: Lark.LoggerLevel.warn,
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
          content = '---';
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
      const format = FeishuChannel._detectMsgFormat(text);

      switch (format) {
        case 'text':
          await this._sendText(chatId, text);
          break;
        case 'post':
          await this._sendPost(chatId, text);
          break;
        case 'interactive':
          await this._sendCard(chatId, this._buildCardElements(text));
          break;
      }

      logger.info({ jid, length: text.length, format }, 'Feishu message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Feishu message');
    }
  }

  private async _sendText(chatId: string, text: string): Promise<void> {
    // Split long messages (Feishu limit is 4000 chars for text)
    const MAX_LENGTH = 4000;
    const messages =
      text.length > MAX_LENGTH ? [text.slice(0, MAX_LENGTH)] : [text];

    for (const message of messages) {
      logger.debug({ text: message }, 'send feishu text message');
      await this.client!.im.v1.message.create({
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

  // ── Markdown parsing and formatting ──────────────────────────────────

  private static readonly _TABLE_RE =
    /((?:^[ \t]*\|.+\|[ \t]*\n)(?:^[ \t]*\|[-:\s|]+\|[ \t]*\n)(?:^[ \t]*\|.+\|[ \t]*\n?)+)/gmu;

  private static readonly _HEADING_RE = /^(#{1,6})\s+(.+)$/gmu;

  private static readonly _CODE_BLOCK_RE = /(```[\s\S]*?```)/gmu;

  // Markdown formatting patterns that should be stripped from plain-text
  // surfaces like table cells and heading text.
  private static readonly _MD_BOLD_RE = /\*\*(.+?)\*\*/;
  private static readonly _MD_BOLD_UNDERSCORE_RE = /__(.+?)__/;
  private static readonly _MD_ITALIC_RE = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/;
  private static readonly _MD_STRIKE_RE = /~~(.+?)~~/;

  private static _stripMdFormatting(text: string): string {
    text = text.replace(this._MD_BOLD_RE, '$1');
    text = text.replace(this._MD_BOLD_UNDERSCORE_RE, '$1');
    text = text.replace(this._MD_ITALIC_RE, '$1');
    text = text.replace(this._MD_STRIKE_RE, '$1');
    return text;
  }

  private static _split(line: string): string[] {
    return line
      .trim()
      .split('|')
      .map((c) => c.trim());
  }

  private static _parseMdTable(tableText: string): FeishuTableElement | null {
    const lines = tableText
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    if (lines.length < 3) return null;

    const headers = this._split(lines[0]).map((h) =>
      this._stripMdFormatting(h),
    );
    const rows = lines
      .slice(2)
      .map((line) => this._split(line).map((c) => this._stripMdFormatting(c)));

    const columns: FeishuTableColumn[] = headers.map((h, i) => ({
      tag: 'column',
      name: `c${i}`,
      display_name: h,
      width: 'auto',
    }));

    return {
      tag: 'table',
      page_size: rows.length + 1,
      columns,
      rows: rows.map((r) =>
        Object.fromEntries(headers.map((_, i) => [`c${i}`, r[i] ?? ''])),
      ),
    };
  }

  private _buildCardElements(content: string): FeishuElement[] {
    const elements: FeishuElement[] = [];
    let lastEnd = 0;

    for (const m of content.matchAll(FeishuChannel._TABLE_RE)) {
      const before = content.slice(lastEnd, m.index);
      if (before.trim()) {
        elements.push(...this._splitHeadings(before));
      }
      const parsed = FeishuChannel._parseMdTable(m[1]);
      elements.push(parsed ?? { tag: 'markdown', content: m[1] });
      lastEnd = m.index! + m[0].length;
    }

    const remaining = content.slice(lastEnd);
    if (remaining.trim()) {
      elements.push(...this._splitHeadings(remaining));
    }

    return elements.length ? elements : [{ tag: 'markdown', content }];
  }

  private static _splitElementsByTableLimit(
    elements: FeishuElement[],
    maxTables = 1,
  ): FeishuElement[][] {
    if (!elements.length) return [[]];

    const groups: FeishuElement[][] = [];
    let current: FeishuElement[] = [];
    let tableCount = 0;

    for (const el of elements) {
      if ('tag' in el && el.tag === 'table') {
        if (tableCount >= maxTables) {
          if (current.length) groups.push(current);
          current = [];
          tableCount = 0;
        }
        current.push(el);
        tableCount++;
      } else {
        current.push(el);
      }
    }

    if (current.length) groups.push(current);
    return groups.length ? groups : [[]];
  }

  private _splitHeadings(content: string): FeishuElement[] {
    // Protect code blocks
    const codeBlocks: string[] = [];
    let protected_ = content;
    for (const m of protected_.matchAll(FeishuChannel._CODE_BLOCK_RE)) {
      codeBlocks.push(m[1]);
      protected_ = protected_.replace(
        m[1],
        `\x00CODE${codeBlocks.length - 1}\x00`,
      );
    }

    const elements: FeishuElement[] = [];
    let lastEnd = 0;

    for (const m of protected_.matchAll(FeishuChannel._HEADING_RE)) {
      const before = protected_.slice(lastEnd, m.index).trim();
      if (before) {
        elements.push({ tag: 'markdown', content: before });
      }
      const text = FeishuChannel._stripMdFormatting(m[2].trim());
      const displayText = text ? `**${text}**` : '';
      elements.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: displayText,
        },
      });
      lastEnd = m.index! + m[0].length;
    }

    const remaining = protected_.slice(lastEnd).trim();
    if (remaining) {
      elements.push({ tag: 'markdown', content: remaining });
    }

    // Restore code blocks
    for (let i = 0; i < codeBlocks.length; i++) {
      for (const el of elements) {
        if ('content' in el && typeof el.content === 'string') {
          el.content = el.content.replace(`\x00CODE${i}\x00`, codeBlocks[i]);
        }
      }
    }

    return elements.length ? elements : [{ tag: 'markdown', content }];
  }

  // ── Smart format detection ──────────────────────────────────────────

  // Patterns that indicate "complex" markdown needing card rendering
  private static readonly _COMPLEX_MD_RE =
    /```|^\|.+\|.*\n\s*\|[-:\s|]+\||^#{1,6}\s+/mu;

  // Simple markdown patterns (bold, italic, strikethrough)
  private static readonly _SIMPLE_MD_RE =
    /\*\*.+?\*\*|__.+?__|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|~~.+?~~/mu;

  // Markdown link: [text](url)
  private static readonly _MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;

  // Unordered list items
  private static readonly _LIST_RE = /^[\s]*[-*+]\s+/mu;

  // Ordered list items
  private static readonly _OLIST_RE = /^[\s]*\d+\.\s+/mu;

  // Max length for plain text format
  private static readonly _TEXT_MAX_LEN = 200;

  // Max length for post (rich text) format; beyond this, use card
  private static readonly _POST_MAX_LEN = 2000;

  private static _detectMsgFormat(content: string): MessageFormat {
    const stripped = content.trim();

    // Complex markdown (code blocks, tables, headings) → always card
    if (this._COMPLEX_MD_RE.test(stripped)) {
      return 'interactive';
    }

    // Long content → card (better readability with card layout)
    if (stripped.length > this._POST_MAX_LEN) {
      return 'interactive';
    }

    // Has bold/italic/strikethrough → card (post format can't render these)
    if (this._SIMPLE_MD_RE.test(stripped)) {
      return 'interactive';
    }

    // Has list items → card (post format can't render list bullets well)
    if (this._LIST_RE.test(stripped) || this._OLIST_RE.test(stripped)) {
      return 'interactive';
    }

    // Has links → post format (supports <a> tags)
    if (this._MD_LINK_RE.test(stripped)) {
      return 'post';
    }

    // Short plain text → text format
    if (stripped.length <= this._TEXT_MAX_LEN) {
      return 'text';
    }

    // Medium plain text without any formatting → post format
    return 'post';
  }

  private static _markdownToPost(content: string): Record<string, unknown> {
    const lines = content.trim().split('\n');
    const paragraphs: Record<string, unknown>[][] = [];

    for (const line of lines) {
      const els: Record<string, unknown>[] = [];
      let lastEnd = 0;

      for (const m of line.matchAll(this._MD_LINK_RE)) {
        const before = line.slice(lastEnd, m.index);
        if (before) {
          els.push({ tag: 'text', text: before });
        }
        els.push({
          tag: 'a',
          text: m[1],
          href: m[2],
        });
        lastEnd = m.index! + m[0].length;
      }

      const remaining = line.slice(lastEnd);
      if (remaining) {
        els.push({ tag: 'text', text: remaining });
      }

      // Empty line → empty paragraph for spacing
      if (!els.length) {
        els.push({ tag: 'text', text: '' });
      }

      paragraphs.push(els);
    }

    const postBody = {
      zh_cn: {
        content: paragraphs,
      },
    };
    return postBody;
  }

  private _sendCard(chatId: string, elements: FeishuElement[]): Promise<void> {
    if (!this.client) {
      logger.warn('Feishu client not initialized');
      return Promise.resolve();
    }

    const elementGroups = FeishuChannel._splitElementsByTableLimit(elements);

    return (async () => {
      for (const group of elementGroups) {
        const cardContent = {
          config: { wide_screen_mode: true },
          elements: group,
        };
        logger.debug({ cardContent }, 'send feishu interactive message');
        await this.client!.im.v1.message.create({
          params: {
            receive_id_type: 'chat_id',
          },
          data: {
            receive_id: chatId,
            content: JSON.stringify(cardContent),
            msg_type: 'interactive',
          },
        });
      }
    })();
  }

  private _sendPost(chatId: string, content: string): Promise<void> {
    if (!this.client) {
      logger.warn('Feishu client not initialized');
      return Promise.resolve();
    }

    const postBody = FeishuChannel._markdownToPost(content);
    logger.debug({ postBody }, 'send feishu post message');
    return this.client.im.v1.message
      .create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          content: JSON.stringify(postBody),
          msg_type: 'post',
        },
      })
      .then(() => undefined);
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
