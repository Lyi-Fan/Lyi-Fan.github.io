// 石头人吉祥物交互逻辑
document.addEventListener('DOMContentLoaded', function() {
    const golem = document.getElementById('golem-mascot');
    
    if (!golem) return;
    
    let isHovering = false;
    
    // 检测鼠标位置，判断是否靠近左下角
    document.addEventListener('mousemove', function(e) {
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        const windowHeight = window.innerHeight;
        
        // 定义触发区域：左侧 300px，底部 300px
        const triggerZoneX = 300;
        const triggerZoneY = windowHeight - 300;
        
        // 如果鼠标在触发区域内，显示石头人
        if (mouseX < triggerZoneX && mouseY > triggerZoneY) {
            if (!golem.classList.contains('show')) {
                golem.classList.add('show');
            }
        } else {
            // 如果不在悬停状态，隐藏石头人
            if (!isHovering && golem.classList.contains('show')) {
                golem.classList.remove('show');
            }
        }
    });
    
    // 鼠标进入石头人时，标记悬停状态
    golem.addEventListener('mouseenter', function() {
        isHovering = true;
    });
    
    // 鼠标离开石头人时，取消悬停状态并隐藏
    golem.addEventListener('mouseleave', function() {
        isHovering = false;
        golem.classList.remove('show');
    });
    
    // 点击时切换到开心状态并保持2秒
    golem.addEventListener('click', function() {
        this.style.backgroundImage = "url('/img/golem-happy.png')";
        
        // 2秒后恢复待机状态
        setTimeout(function() {
            golem.style.backgroundImage = "url('/img/golem-idle.png')";
        }, 2000);
    });
});
