# 申报提醒像素字体

`payroll-reminder.woff2` 是 Fusion Pixel Font 12px Proportional 简体中文版本的字符子集，只包含申报提醒所用文字（约 2 KB）。字体在本站提供，不连接外部字体服务。

- 上游：https://github.com/TakWolf/fusion-pixel-font
- 版本：2026.09.01
- 源文件：`fusion-pixel-12px-proportional-zh_hans.ttf.woff2`
- 字体许可证见 `OFL.txt`，上游字形许可证见 `LICENSES/`。

重新生成需使用带 Brotli 支持的 FontTools：

```sh
pyftsubset fusion-pixel-12px-proportional-zh_hans.ttf.woff2 \
  --text='请【最晚】在三号之前完成上个月的工资申报并提交' \
  --flavor=woff2 --output-file=payroll-reminder.woff2 \
  --layout-features='*' --name-IDs='*' --name-languages='*'
```
