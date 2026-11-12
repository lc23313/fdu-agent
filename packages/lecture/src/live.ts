export type LiveLine = { text: string; start: number; end: number; speaker: null };
export class LectureLive {
  private socket: WebSocket | null = null;
  private retired = new Set<WebSocket>();
  private frames: { bytes: ArrayBuffer; at: number }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ready = false;
  private sent = false;
  private ended = false;
  private connecting = false;
  readonly lines = new Map<string, LiveLine>();
  gap = false;
  private ticket: () => Promise<{ url: string }>;
  private changed: (status: string) => void;
  private text: () => void;
  private open: (url: string) => WebSocket;
  constructor(
    ticket: () => Promise<{ url: string }>,
    changed: (status: string) => void,
    text: () => void,
    open = (url: string) => new WebSocket(url),
  ) {
    this.ticket = ticket;
    this.changed = changed;
    this.text = text;
    this.open = open;
  }
  frame(bytes: ArrayBuffer, at: number) {
    if (this.ended) return;
    this.frames.push({ bytes, at });
    if (this.frames.length > 100) {
      this.frames.shift();
      this.gap = true;
    }
    this.drain();
  }
  private drain() {
    const ws = this.socket;
    if (!this.ready || ws?.readyState !== 1) return;
    while (this.frames.length && ws.bufferedAmount < 64000) {
      const frame = this.frames.shift()!;
      if (!this.sent) {
        ws.send(JSON.stringify({ offset: Math.max(0, Math.round(frame.at)) }));
        this.sent = true;
      }
      ws.send(frame.bytes);
    }
  }
  async connect() {
    if (this.ended || this.connecting || this.socket) return;
    this.connecting = true;
    try {
      this.changed('正在连接实时识别');
      const { url } = await this.ticket();
      if (this.ended) return;
      const ws = this.open(url);
      this.socket = ws;
      this.sent = false;
      this.ready = false;
      ws.onmessage = (event) => {
        try {
          const value = JSON.parse(String(event.data));
          if (value.type === 'ready' && this.socket === ws && !this.ended) {
            this.ready = true;
            this.changed('实时识别已连接');
            this.drain();
          }
          if (value.type === 'sentence') {
            this.lines.set(value.session + ':' + value.seq, value.segment);
            this.text();
          }
          if (value.type === 'rotate' && this.socket === ws && !this.ended) {
            this.retired.add(ws);
            this.socket = null;
            this.ready = false;
            this.changed('正在续接实时识别，原录音持续保存');
            void this.connect();
          }
          if (value.type === 'error') this.changed(value.message);
        } catch {
          this.gap = true;
        }
      };
      ws.onclose = () => {
        this.retired.delete(ws);
        if (this.socket !== ws) return;
        this.socket = null;
        this.ready = false;
        if (!this.ended) {
          this.gap = true;
          this.changed('实时识别断开，原录音持续保存');
          this.timer = setTimeout(() => void this.connect(), 1500);
        }
      };
      ws.onerror = () => {
        this.gap = true;
      };
    } catch (error) {
      this.changed(error instanceof Error ? error.message : '实时连接失败');
      if (!this.ended) this.timer = setTimeout(() => void this.connect(), 5000);
    } finally {
      this.connecting = false;
    }
  }
  pause() {
    clearTimeout(this.timer);
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    this.frames = [];
    socket?.close();
  }
  finish() {
    this.ended = true;
    clearTimeout(this.timer);
    if (this.frames.length) this.gap = true;
    const sockets = [this.socket, ...this.retired];
    for (const ws of sockets) {
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'finish' }));
      else ws?.close();
    }
    const timer = setTimeout(() => sockets.forEach((ws) => ws?.close()), 12000);
    return () => {
      clearTimeout(timer);
      sockets.forEach((ws) => ws?.close());
    };
  }
}
