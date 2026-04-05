<div class="global-footer">
    <!-- <div class="footer-content">
        <div class="footer-section">
            <h4>Psyzx Music</h4>
            <p>Your personal self-hosted music sanctuary.</p>
        </div>
        <div class="footer-section">
            <h4>Links</h4>
            <ul>
                <li><a href="#home">Home</a></li>
                <li><a href="#settings">Settings</a></li>
                <li><a href="#about">About</a></li>
            </ul>
        </div>
    </div> -->
    <div class="footer-bottom">
        <p>&copy; {new Date().getFullYear()} Psyzx. All rights reserved.</p>
    </div>
</div>

<style>
    .global-footer {
        width: 100%;
        padding: 0px 0px 170px 0px; /* adjust this bro */
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        margin-top: 40px;
        box-sizing: border-box;
    }

    .footer-content {
        display: flex;
        flex-wrap: wrap;
        gap: 40px;
        max-width: 1200px;
        margin: 0 auto;
        padding-bottom: 24px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .footer-section {
        flex: 1;
        min-width: 200px;
    }

    .footer-section h4 {
        color: white;
        font-size: 16px;
        font-weight: 700;
        margin-bottom: 16px;
    }

    .footer-section p {
        font-size: 14px;
        line-height: 1.5;
    }

    .footer-section ul {
        list-style: none;
        padding: 0;
        margin: 0;
    }

    .footer-section li {
        margin-bottom: 8px;
    }

    .footer-section a {
        color: rgba(255, 255, 255, 0.5);
        text-decoration: none;
        font-size: 14px;
        transition: color 0.2s;
    }

    .footer-section a:hover {
        color: var(--accent-color, #b534d1);
    }

    .footer-bottom {
        text-align: center;
        padding-top: 24px;
        font-size: 12px;
    }
</style>