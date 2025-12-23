// 石头人吉祥物交互逻辑
document.addEventListener('DOMContentLoaded', function() {
    const golem = document.getElementById('golem-mascot');
    
    if (!golem) return;
    
    // 点击时切换到开心状态并保持2秒
    golem.addEventListener('click', function() {
        this.style.backgroundImage = "url('/img/golem-happy.png')";
        this.style.transform = 'scale(1.15) translateY(-8px)';
        
        // 2秒后恢复待机状态
        setTimeout(function() {
            golem.style.backgroundImage = "url('/img/golem-idle.png')";
            golem.style.transform = '';
        }, 2000);
    });
});
