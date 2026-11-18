# 流浪地球 · 轨道观测台

[观看电影与自由探索](https://yancheng0518.github.io/earth-migration-atlas/) · [打开离线单文件](https://yancheng0518.github.io/earth-migration-atlas/standalone.html)

108 秒、2.39∶1 的交互式宽银幕电影。镜头从衰暗的太阳飞向地球，经过地面救援车队、行星发动机、太空电梯与轨道货运编队，最后随地球飞向比邻星。

按 **空格** 暂停或继续，按 **E** 进入自由探索。拖动环视，向上滚动靠近目标，向下滚动返回轨道。触屏支持双指缩放。

## 电影原声

点击「电影原声」，在网易云音乐官方播放器中播放阿鲲的《开启新征程》。收起播放器或切换到自由探索可继续听，点击「关闭音乐」结束播放。官方播放器需联网，暂停与进度由播放器自身控制。原视频关联的 Lena 剪辑版可在[抖音单曲页](https://www.douyin.com/music/7579192127771985963)对照试听。

如持有自己的音源，可展开「用本机音源同步电影」，选取音频并填入音乐高潮所在的秒数。电影把这个位置对齐 01:38 的地球推进，暂停、跳章和重播跟随镜头，自由探索时循环。文件只在本机播放。网页、影片回放和离线包均不含商业原声录音。

## 本地运行

直接打开 [out/index.html](out/index.html) 可离线观看和交互。需要修改场景时，在仓库根目录运行 `python -m http.server --directory dist`，然后在浏览器中访问 `http://localhost:8000/`。用 `python build_single.py` 可重新生成单文件。

地球与太阳系素材的来源见 [地表影像与高程致谢](dist/assets/earth/CREDITS.txt) 和 [天文影像致谢](dist/assets/journey/CREDITS.txt)。这是《流浪地球》主题的非官方致敬作品。
