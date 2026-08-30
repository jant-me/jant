# 视频/音频上传:避免无谓重编码,提高必须重编码时的质量

## 问题

`video-processor.ts` / `audio-processor.ts` 无条件传 `bitrate: QUALITY_HIGH`。
mediabunny 把「设置了 quality/bitrate」当作强制转码信号(`conversion.ts:1361-1377`
视频、`1625-1637` 音频),于是**每一个**视频都被完整解码 + 重编码,哪怕它本来
就是 H.264/AAC MP4、尺寸也在上限内 —— 一次纯白给的代际质量损失。

## 决定

- 尺寸上限保持 1920(长边) / 1080(短边) 不变
- 真正需要重编码时:`QUALITY_HIGH`(0.75,AVC 量化器 22)→ `new Quality("very-high")`
  (1.0,量化器 16,1080p 码率兜底约 12 Mbps)

## 任务

- [x] `video-processor.ts`:探测源的视频/音频编码格式(扩展现有的 `extractPoster`,
      它已经开了 Input 并读了 displayWidth/rotation/duration)
- [x] `video-processor.ts`:只在需要缩放时传 `width`/`height`/`fit`;只在需要
      重编码时传 `quality`(源非 avc,或需要缩放)
- [x] `video-processor.ts`:音轨同理 —— 源已是 aac 就不传 quality,让它直接拷贝
- [x] `audio-processor.ts`:同样的探测 + 条件 quality
- [x] 更新两个文件的头部 JSDoc 说明新行为
- [x] `mise run check-tests` + `check-lint`
- [x] 实机验证:传一个 H.264 MP4,确认输出体积 ≈ 原文件(走了拷贝路径)

## 结果

全部完成。

**改动**

- `video-processor.ts`:`extractPoster` → `probeSource`,顺带读出源的视频/音频编码
  格式;新增导出的纯函数 `planVideoProcessing()`(照 `planImageProcessing` 的样子),
  决定要不要缩放 / 重编码视频轨 / 重编码音频轨;`Conversion.init` 只在需要时才传
  `width`/`height`/`fit` 和 `quality`。顺手修掉一个既有小 bug:`probeSource` 里
  canvas 取不到 2d context 的两个提前返回会丢掉 `rotation` 和 `durationSeconds`,
  现在统一从 `base` 展开。
- `audio-processor.ts`:同样的条件 quality。
- 新增 `__tests__/video-processor.test.ts`,11 个用例覆盖决策矩阵。

**验证**

- `check-types` / `check-lint` 通过;`check-format` 对这几个文件无警告(仓库里
  另外 37 个文件的格式警告是既有的,与本次无关)。
- `check-tests`:292 文件 / 3861 测试全绿。
- 用 ffmpeg 造的 1280×720、7.6 Mbps H.264 + AAC MP4,在 Node 里直接跑 mediabunny:
  - 旧参数:视频轨和音频轨都被判为需要解码器(Node 无 WebCodecs → `undecodable_source_codec`),
    证明每个源都被强制重编码。
  - 新参数:视频轨未被丢弃 = 走了拷贝路径。导出后用 ffmpeg 比对视频流 MD5,
    与源**完全一致**(`d14ee436…`)—— 零质量损失。
  - 带 `display_rotation 90` 的样本同样走拷贝路径,输出 `rotation=90` 保持不变,
    视频流 MD5 仍然一致 —— 竖屏视频不会转向。

**已知遗留(非本次引入)**
ffmpeg/相机产出的 AAC 音轨通常有 encoder priming delay,`firstTimestamp` 为负
(实测 -0.0232s)。mediabunny 必须重编码才能裁掉 priming,所以音轨在多数真实
MP4 上仍会被转成 192 kbps AAC。这是 mediabunny 的设计,新旧代码一样;AAC 在
`high` 和 `very-high` 下都落到 192 kbps,所以没有质量回退。视频轨才是大头,
已经解决。
