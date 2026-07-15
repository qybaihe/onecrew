# 山海星辰 / Shanhai Stars

> Category: OneCrew Original

这是 OneCrew 的可编译 Open Design 输入。它只描述视觉与品牌约束，不承担正式视频渲染。

## Color

- **Primary:** `#2EC4B6`
- **Secondary:** `#FFB703`
- **Background:** `#07111F`
- **Text:** `#F7F3E8`
- **Muted:** `#A6B5C5`
- **Surface:** `#11263A`
- **Success:** `#38B000`
- **Warning:** `#FFB703`
- **Danger:** `#EF476F`

## Typography

- **Chinese Font:** PingFang SC
- **English Font:** Inter
- **Display Font:** Songti SC
- **Fallback:** system-ui, sans-serif
- **Body Size:** 32
- **Subtitle Size:** 44
- **Weights:** 400, 600, 700
- **Line Height:** 1.35

## Spacing

- **Unit:** 8
- **Scale:** 0, 8, 16, 24, 32, 48, 64, 96
- **Safe Horizontal:** 6
- **Safe Vertical:** 8

## Layout

- **Grid Columns:** 12
- **Max Width:** 1920
- **Portrait Strategy:** keep the hero subject inside the center 56 percent and reflow titles above the lower subtitle safe area
- **Square Strategy:** preserve the hero subject and place the CTA in a dedicated bottom band

## Components

- **Title Card:** warm serif title over a deep-blue field with a restrained teal horizon line
- **Lower Third:** compact translucent navy plate with a teal leading rule
- **Subtitle:** no more than two lines on a high-contrast navy plate
- **CTA:** one amber action line paired with the logo lockup
- **Logo:** use the mountain-star mark without glow or decorative distortion

## Motion

- **Fast Frames:** 6
- **Normal Frames:** 12
- **Slow Frames:** 24
- **Easing:** cubic-bezier(0.22, 1, 0.36, 1)
- **Default Transition:** cross-dissolve
- **Max Motion Density:** 0.4
- **Logo Reveal:** opacity with a restrained 1.02-to-1 scale settle
- **Reduced Motion Fallback:** hard cut followed by a two-frame opacity settle

## Voice

- **Chinese Tone:** 克制、辽阔、有人情味，短句优先
- **English Tone:** cinematic, concise, human, and locally idiomatic

## Brand

- **Name Zh:** 山海星辰
- **Name En:** Shanhai Stars
- **Logo Asset:** assets/logo.svg
- **Logo Clearspace:** 32

## Anti-patterns

- 未授权素材或来源不明的字体
- 牺牲字幕安全区换取画面冲击
- 无叙事作用的粒子、光晕与镜头抖动
- 逐字直译的英文宣传语
- 把 Open Design 预览误当成正式视频渲染
