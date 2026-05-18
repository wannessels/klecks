import styles from './chat-overlay.module.scss';

export type TChatOverlayOptions = {
    closeable: boolean;
    allowImageUpload: boolean;
    onClose?: () => void;
    onSendText?: (text: string) => void;
    onSendImage?: (base64Jpeg: string) => void;
};

export class ChatOverlay {
    private readonly rootEl: HTMLElement;
    private readonly messagesEl: HTMLElement;
    private readonly inputEl: HTMLInputElement;
    private readonly opts: TChatOverlayOptions;

    constructor(opts: TChatOverlayOptions) {
        this.opts = opts;

        this.rootEl = document.createElement('div');
        this.rootEl.className = styles.chatOverlay;
        this.rootEl.setAttribute('data-testid', 'chat-overlay');

        if (opts.closeable) {
            const header = document.createElement('div');
            header.className = styles.header;
            const close = document.createElement('button');
            close.className = styles.close;
            close.setAttribute('data-testid', 'chat-close');
            close.textContent = '×';
            close.addEventListener('click', () => this.hide());
            header.append(close);
            this.rootEl.append(header);
        }

        this.messagesEl = document.createElement('div');
        this.messagesEl.className = styles.messages;
        this.messagesEl.setAttribute('data-testid', 'chat-messages');
        this.rootEl.append(this.messagesEl);

        const row = document.createElement('div');
        row.className = styles.inputRow;

        let attachInput: HTMLInputElement | undefined;
        if (opts.allowImageUpload) {
            const attach = document.createElement('button');
            attach.className = styles.attach;
            attach.setAttribute('data-testid', 'chat-attach');
            attach.textContent = '+';
            attachInput = document.createElement('input');
            attachInput.type = 'file';
            attachInput.accept = 'image/*';
            attachInput.style.display = 'none';
            attachInput.setAttribute('data-testid', 'chat-attach-input');
            attach.addEventListener('click', () => attachInput!.click());
            attachInput.addEventListener('change', async () => {
                const f = attachInput!.files?.[0];
                attachInput!.value = '';
                if (!f) return;
                try {
                    const { prepareImageForSend } = await import('./prepare-image-for-send');
                    const base64 = await prepareImageForSend(f);
                    this.opts.onSendImage?.(base64);
                } catch (e) {
                    console.error('[chat] image prep failed', e);
                }
            });
            row.append(attach);
            row.append(attachInput);
        }

        this.inputEl = document.createElement('input');
        this.inputEl.type = 'text';
        this.inputEl.className = styles.input;
        this.inputEl.setAttribute('data-testid', 'chat-input');
        this.inputEl.addEventListener('keydown', (e) => {
            // Suppress propagation so Klecks's global shortcuts don't fire while typing.
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                this.submit();
            }
        });
        this.inputEl.addEventListener('keyup', (e) => e.stopPropagation());
        row.append(this.inputEl);

        const send = document.createElement('button');
        send.className = styles.send;
        send.setAttribute('data-testid', 'chat-send');
        send.textContent = 'Send';
        send.addEventListener('click', () => this.submit());
        row.append(send);

        this.rootEl.append(row);
    }

    getElement() { return this.rootEl; }

    renderIncoming(msg: { kind: 'text'; text: string; mine: boolean } | { kind: 'image'; data: string; mine: boolean }) {
        if (msg.kind === 'text') this.appendTextBubble(msg.text, msg.mine);
        else this.appendImageBubble(msg.data, msg.mine);
    }

    show() {
        if (!this.rootEl.isConnected) document.body.append(this.rootEl);
    }

    hide() {
        if (this.rootEl.isConnected) this.rootEl.remove();
        this.opts.onClose?.();
    }

    private submit() {
        const text = this.inputEl.value.trim();
        if (!text) return;
        this.opts.onSendText?.(text);
        this.inputEl.value = '';
    }

    private appendImageBubble(base64: string, mine: boolean) {
        const wrap = document.createElement('div');
        wrap.className = `${styles.bubble} ${mine ? styles.mine : styles.theirs}`;
        wrap.setAttribute('data-testid', mine ? 'chat-bubble-mine' : 'chat-bubble-theirs');
        const img = document.createElement('img');
        img.src = `data:image/jpeg;base64,${base64}`;
        img.style.maxWidth = '100%';
        img.style.maxHeight = '240px';
        img.style.cursor = 'pointer';
        img.setAttribute('data-testid', 'chat-image-thumb');
        // Lightbox wiring lands in Task 9.
        wrap.append(img);
        this.messagesEl.append(wrap);
        this.scrollToBottomIfNotPinned();
    }

    private appendTextBubble(text: string, mine: boolean) {
        const el = document.createElement('div');
        el.className = `${styles.bubble} ${mine ? styles.mine : styles.theirs}`;
        el.setAttribute('data-testid', mine ? 'chat-bubble-mine' : 'chat-bubble-theirs');
        el.textContent = text;
        this.messagesEl.append(el);
        this.scrollToBottomIfNotPinned();
    }

    private scrollToBottomIfNotPinned() {
        // Simple version: always pin to bottom for now. Refined later if needed.
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
}
