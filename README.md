# vue-excel Canvas绘制单元格图片

## 概述

vue-excel 使用 HTML5 Canvas 技术在电子表格中绘制单元格图片，支持两种图片类型：
- 普通媒体图片（通过 `_media` 数组管理）
- 嵌入型 DISPIMG 公式图片（通过 `=DISPIMG("ID", index)` 公式定义）

## 核心文件

| 文件路径 | 功能描述 |
|---------|---------|
| `src/x-spreadsheet/canvas/draw.js` | Canvas绑定、绘图基础类 |
| `src/media.js` | 图片渲染核心逻辑 |
| `src/stores/dispimgStore.js` | 图片数据存储 |
| `src/main.vue` | 主组件，整合渲染流程 |
| `src/x-spreadsheet/core/data_proxy.js` | 数据代理，单元格位置计算 |

## 架构设计

### 1. Canvas绑定

**Draw 类** (`src/x-spreadsheet/canvas/draw.js`)

```javascript
class Draw {
  constructor(el, width, height) {
    this.el = el;
    this.ctx = el.getContext('2d');
    this.resize(width, height);
    this.ctx.scale(dpr(), dpr());
  }
}
```

**关键工具函数**：

- `dpr()`: 获取设备像素比
- `npx(px)`: 像素转换，根据设备像素比缩放

### 2. 图片数据存储

**dispimgStore** (`src/stores/dispimgStore.js`)

全局存储对象，管理图片映射关系：

```javascript
export const dispimgStore = {
    formulaImageMap: null,     // { "ID_XXXX": 0, "ID_YYYY": 1 }
    allSheetImages: null,      // [ [img1, img2, ...], [sheet2Img1, ...] ]
    imageCell: {},             // 图片单元格位置信息
}
```

### 3. Excel图片解析

**buildImageMap** (`src/media.js`)

从 Excel 文件中提取图片数据：

1. 使用 JSZip 解压 Excel 文件
2. 读取 `xl/cellimages.xml` 获取图片ID映射
3. 加载 `xl/media/image*` 目录下的所有图片文件
4. 将图片数据存储到 dispimgStore

```javascript
export async function buildImageMap(excelBlobOrBuffer) {
    return JSZip.loadAsync(excelBlobOrBuffer)
        .then(zip => {
            const cellImagesXml = zip.file("xl/cellimages.xml");
            // 解析 XML，构建 formulaImageMap
            // 加载所有图片文件，构建 allSheetImages
        });
}
```

## 渲染流程

### 1. 主渲染流程

**main.vue** 重写 `table.render` 方法，在表格渲染后绘制图片：

```javascript
let tableRender = xs.sheet.table.render;
xs.sheet.table.render = function (...args) {
    xs && xs.sheet && tableRender.apply(xs.sheet.table, args);
    renderImageDebounce(ctx, mediasSource, workbookDataSource._worksheets[sheetIndex],
                        offset, props.options);
};
```

### 2. 图片渲染函数

**renderImage** (`src/media.js`)

核心渲染函数，分两步绘制：

#### 第一步：绘制普通媒体图片

```javascript
if (sheet && sheet._media.length) {
    sheet._media.forEach(media => {
        let {imageId, range, type} = media;
        let position = calcPosition(sheet, range, offset, options);
        if (type === 'image') {
            drawImage(ctx, imageId, medias[imageId], position);
        }
    });
}
```

#### 第二步：绘制嵌入型 DISPIMG 图片

```javascript
const formulaImageMap = dispimgStore.getFormulaMap();
const allSheetImages = dispimgStore.getAllSheetImages();

for (let ri = 1; ri <= rowCount; ri++) {
    for (let ci = 1; ci <= colCount; ci++) {
        const cell = sheet.getCell(ri, ci);
        if (cell.text && cell.text.startsWith('=DISPIMG')) {
            const match = cell.text.match(/^=DISPIMG\("(.+?)",\s*(\d+)\)/);
            if (match) {
                const imageId = match[1];
                const mediaIndex = formulaImageMap[imageId];
                const img = allSheetImages?.[0]?.[mediaIndex];

                const cellInfo = dispimgStore.getImageCell(imageId);
                // 加载并绘制图片，保持比例、居中显示
            }
        }
    }
}
```

### 3. 位置计算

**calcPosition** (`src/media.js`)

计算图片在 Canvas 上的绘制位置：

```javascript
function calcPosition(sheet, range, offset, options) {
    // 计算基础 X 坐标（考虑左侧序号列宽）
    let basicX = clipWidth;
    for (let i = 0; i < nativeCol; i++) {
        basicX += sheet?._columns?.[i]?.width * 6 || defaultColWidth;
    }

    // 计算基础 Y 坐标（考虑顶部序号行高）
    let basicY = clipHeight;
    for (let i = 0; i < nativeRow; i++) {
        basicY += sheet?._rows?.[i]?.height || defaultRowHeight;
    }

    // 返回最终位置（考虑滚动偏移和设备像素比）
    return {
        x: (x - (offset?.scroll?.x || 0)) * devicePixelRatio,
        y: (y - (offset?.scroll?.y || 0)) * devicePixelRatio,
        width: width * devicePixelRatio,
        height: height * devicePixelRatio
    };
}
```

**常量定义**：

- `clipWidth = 60`: 左侧序号列宽
- `clipHeight = 25`: 顶部序号行高
- `defaultColWidth = 80`: 默认列宽
- `defaultRowHeight = 24`: 默认行高

### 4. 图片绘制

**drawImage** (`src/media.js`)

执行实际的 Canvas 绘制操作：

```javascript
function drawImage(ctx, index, data, position) {
    getImage(index, data).then(image => {
        let sx = 0, sy = 0;
        let sWidth = image.width;
        let sHeight = image.height;
        let dx = position.x;
        let dy = position.y;
        let dWidth = position.width;
        let dHeight = position.height;

        // 处理裁剪（当图片被序号列/行遮挡时）
        if (dx < clipWidth * devicePixelRatio) {
            let diff = clipWidth * devicePixelRatio - dx;
            dx = clipWidth * devicePixelRatio;
            dWidth -= diff;
            sWidth -= diff / scaleX;
            sx += diff / scaleX;
        }

        // 执行绘制
        let scale = window.outerWidth / window.innerWidth;
        ctx.drawImage(image, sx, sy, sWidth, sHeight,
                     dx * scale, dy * scale, dWidth * scale, dHeight * scale);
    });
}
```

### 5. 图片加载与缓存

**getImage** (`src/media.js`)

异步加载图片并缓存：

```javascript
let cache = [];

function getImage(index, data) {
    return new Promise(((resolve, reject) => {
        if (cache[index]) {
            return resolve(cache[index]);
        }
        const {buffer} = data.buffer;
        let blob = new Blob([buffer], {type: 'image/' + data.extension});
        let url = URL.createObjectURL(blob);
        let image = new Image();
        image.src = url;
        image.onload = function () {
            resolve(image);
            cache[index] = image;
        };
    }));
}
```

## DISPIMG 图片渲染细节

### 图片适配与居中

嵌入型图片需要适配单元格大小并保持原始比例：

```javascript
const imgRatio = imgWidth / imgHeight;
const cellRatio = cellWidth / cellHeight;

let drawWidth, drawHeight;

if (imgRatio > cellRatio) {
    drawWidth = cellWidth;
    drawHeight = drawWidth / imgRatio;
} else {
    drawHeight = cellHeight;
    drawWidth = drawHeight * imgRatio;
}

// 居中绘制
const offsetX = left + (cellWidth - drawWidth) / 2;
const offsetY = top + (cellHeight - drawHeight) / 2;

ctx.drawImage(image, offsetX * zoom, offsetY * zoom, drawWidth * zoom, drawHeight * zoom);
```

### 单元格位置信息存储

**data_proxy.js** 在计算单元格位置时存储图片单元格信息：

```javascript
if (cell && cell.text && typeof cell.text === 'string' && cell.text.startsWith('=DISPIMG')) {
    const match = cell.text.match(/^=DISPIMG\("(.+?)",\s*(\d+)\)/);
    if (match) {
        const [, imgId] = match;
        dispimgStore.setImageCell(imgId, {left, top, width, height});
    }
}
```

## 技术要点

### 1. 设备像素比处理

所有尺寸计算都考虑设备像素比，确保在高 DPI 屏幕上清晰显示：

```javascript
const zoom = window.devicePixelRatio || 1;
ctx.drawImage(image, offsetX * zoom, offsetY * zoom, drawWidth * zoom, drawHeight * zoom);
```

### 2. 图片裁剪

当图片位置超出可视区域时，自动裁剪并调整绘制参数：

```javascript
if (dx < clipWidth * devicePixelRatio) {
    let diff = clipWidth * devicePixelRatio - dx;
    dx = clipWidth * devicePixelRatio;
    dWidth -= diff;
    sWidth -= diff / scaleX;
    sx += diff / scaleX;
}
```

### 3. 图片缓存机制

使用全局缓存数组存储已加载的 Image 对象，避免重复加载：

```javascript
let cache = [];

if (cache[index]) {
    return resolve(cache[index]);
}
```

### 4. 滚动偏移处理

计算图片位置时考虑滚动偏移量：

```javascript
x: (x - (offset?.scroll?.x || 0)) * devicePixelRatio,
y: (y - (offset?.scroll?.y || 0)) * devicePixelRatio,
```

## 使用示例

### 基本使用

```javascript
import { buildImageMap, renderImage } from './media';

// 1. 加载 Excel 文件并构建图片映射
await buildImageMap(fileData);

// 2. 获取 Canvas 上下文
const canvas = rootRef.value.querySelector('canvas');
const ctx = canvas.getContext('2d');

// 3. 渲染图片
renderImage(ctx, mediasSource, sheet, offset, options);
```

### 清除缓存

```javascript
import { clearCache } from './media';

clearCache();
```

## 性能优化建议

1. **图片缓存**：利用内置缓存机制，避免重复加载
2. **防抖渲染**：使用 `renderImageDebounce` 避免频繁重绘
3. **按需加载**：只加载可视区域内的图片
4. **图片压缩**：在服务端对大图进行预处理

## 依赖库

- **jszip**: 用于解压 Excel 文件
- **DOMParser**: 用于解析 XML 格式的 cellimages.xml

## 注意事项

1. 图片 ID 映射从 Excel 的 `cellimages.xml` 中读取
2. 嵌入型图片使用 `=DISPIMG("ID", index)` 公式定义
3. 所有尺寸计算都基于设备像素比
4. 图片绘制在表格渲染之后执行
5. 滚动时需要重新计算图片位置并重绘
