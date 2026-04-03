import { DOM } from './dom.js';

export const formatTime = (seconds) => {
    if (isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

export const getCorporateFooter = () => `
    <div class="corp-footer">
        <h3>psyzx</h3>
        <p>better than fuckass spotify.</p>
        <p>© 2026 psyzx Corp. All rights reserved.</p>
    </div>
`;

export const updateThemeColor = (imgUrl) => {
    if (!imgUrl) return;
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imgUrl;
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 1; canvas.height = 1;
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        
        window.extractedColor = `rgb(${r},${g},${b})`;
        window.extractedDark = `rgb(${Math.max(0, Math.floor(r * 0.4))},${Math.max(0, Math.floor(g * 0.4))},${Math.max(0, Math.floor(b * 0.4))})`;
        
        if (DOM.audioEl && !DOM.audioEl.paused) {
            document.documentElement.style.setProperty('--accent-color', window.extractedColor);
            document.documentElement.style.setProperty('--accent-dark', window.extractedDark);
        }
    };
};

export const showToast = (message) => {
    if (!DOM.toastMsg) return;
    DOM.toastMsg.textContent = message;
    DOM.toastMsg.classList.add('show');
    setTimeout(() => DOM.toastMsg.classList.remove('show'), 2000);
};