import styles from './image-lightbox.module.scss';

export function openImageLightbox(base64Jpeg: string): void {
    if (document.querySelector('[data-testid="image-lightbox"]')) return;
    const root = document.createElement('div');
    root.className = styles.backdrop;
    root.setAttribute('data-testid', 'image-lightbox');
    const img = document.createElement('img');
    img.className = styles.image;
    img.src = `data:image/jpeg;base64,${base64Jpeg}`;
    root.append(img);
    const close = () => {
        root.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
    };
    root.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.append(root);
}
