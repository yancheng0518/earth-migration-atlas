# 流浪地球 · 轨道观测台

[观看电影与自由探索](https://yancheng0518.github.io/earth-migration-atlas/) · [打开离线单文件](https://yancheng0518.github.io/earth-migration-atlas/standalone.html)

108 秒、2.39∶1 的交互式宽银幕电影。镜头从衰暗的太阳飞向地球，经过地面救援车队、行星发动机、太空电梯与轨道货运编队，最后随地球飞向比邻星。

按 **空格** 暂停或继续，按 **E** 进入自由探索。拖动环视，向上滚动靠近目标，向下滚动返回轨道。触屏支持双指缩放。

## 本地运行

直接打开 [out/index.html](out/index.html) 可离线观看和交互。需要修改场景时，在仓库根目录运行 `python -m http.server --directory dist`，然后在浏览器中访问 `http://localhost:8000/`。用 `python build_single.py` 可重新生成单文件。

地球与太阳系素材的来源见 [地表影像与高程致谢](dist/assets/earth/CREDITS.txt) 和 [天文影像致谢](dist/assets/journey/CREDITS.txt)。这是《流浪地球》主题的非官方致敬作品。
