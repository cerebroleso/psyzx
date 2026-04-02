export const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

export const getCorporateFooter = () => `
    <div class="corp-footer">
        <h3>PSYZX</h3>
        <p>Arch Linux Server Edition</p>
        <p>v3.0 - Svelte Engine</p>
    </div>
`;