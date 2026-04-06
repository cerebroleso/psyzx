<script>
    const currentYear = new Date().getFullYear();
</script>

<div class="global-footer">
    <p>&copy; {currentYear} Psyzx. All rights reserved.</p>
</div>

<style>
    .global-footer {
        width: 100%;
        /* 120px clears your player bar */
        padding: 40px 0px 140px 0px; 
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        box-sizing: border-box;
        text-align: center;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.2);
        /* This pushes it to the bottom of the flex container in app.svelte */
        margin-top: auto; 
    }
</style>