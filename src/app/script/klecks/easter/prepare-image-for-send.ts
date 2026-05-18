const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.8;

export async function prepareImageForSend(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('image decode failed'));
            el.src = url;
        });
        const ratio = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * ratio);
        const h = Math.round(img.naturalHeight * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 2d unavailable');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        const i = dataUrl.indexOf(',');
        if (i < 0) throw new Error('toDataURL malformed');
        return dataUrl.slice(i + 1);
    } finally {
        URL.revokeObjectURL(url);
    }
}
