let cache = [];

import {dispimgStore} from './stores/dispimgStore';

import JSZip from 'jszip';

// 将 Excel Blob/ArrayBuffer 转为 image 映射
export async function buildImageMap(excelBlobOrBuffer) {
    console.log('excelBlobOrBuffer:', excelBlobOrBuffer);
    return JSZip.loadAsync(excelBlobOrBuffer)
        .then(zip => {
            // 找到 cellimages.xml
            const cellImagesXml = zip.file("xl/cellimages.xml");
            if (!cellImagesXml) {
                console.warn('[DISPIMG] 未找到 cellimages.xml');
                return {formulaImageMap: {}, allSheetImages: []};
            }

            return cellImagesXml.async("text").then(async xmlText => {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlText, "text/xml");

                const imageNodes = xmlDoc.getElementsByTagName("xdr:cNvPr");
                const formulaImageMap = {};
                const allSheetImages = [[]]; // 先处理第一个 sheet

                for (let i = 0; i < imageNodes.length; i++) {
                    const node = imageNodes[i];
                    const imageId = node.getAttribute("name"); // name="ID_XXXX"
                    const numericId = node.getAttribute("id"); // id="2"
                    if (imageId) {
                        formulaImageMap[imageId] = Number(numericId) - 2;
                    }
                }

                // 构建所有图片数据
                const mediaFiles = Object.keys(zip.files).filter(name => name.startsWith("xl/media/image"));
                const imagePromises = mediaFiles.map(async (fileName, idx) => {
                    const file = await zip.file(fileName);
                    if (!file) return null;

                    return file.async("arraybuffer").then(buffer => {
                        const ext = fileName.split('.').pop().toLowerCase();
                        return {
                            buffer,
                            extension: ext,
                            type: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
                            index: idx,
                            name: fileName
                        };
                    });
                }).filter(Boolean);

                return Promise.all(imagePromises).then(imageArray => {
                    allSheetImages[0] = imageArray;

                    // 存入全局 store
                    dispimgStore.setFormulaMap(formulaImageMap);
                    dispimgStore.setAllSheetImages(allSheetImages);

                    console.log('[DISPIMG] 初始化完成：', {formulaImageMap, allSheetImages});

                    return {formulaImageMap, allSheetImages};
                });
            });
        });
}


export function renderImage(ctx, medias, sheet, offset, options = {}) {
    if (sheet && sheet._media.length) {
        sheet._media.forEach(media => {
            let {imageId, range, type} = media;
            let position = calcPosition(sheet, range, offset, options);
            if (type === 'image') {
                drawImage(ctx, imageId, medias[imageId], position);
            }
        });
    }

    const formulaImageMap = dispimgStore.getFormulaMap();
    const allSheetImages = dispimgStore.getAllSheetImages();

    if (!formulaImageMap || !allSheetImages) {
        console.log('读取 DISPIMG 图片映射失败')
        return;
    }

    // ✅ 2. 再画嵌入型 DISPIMG 图片
    try {
        const rowCount = sheet.rowCount;
        const colCount = sheet.columnCount;
        let position = calcPosition(sheet, {}, offset, options);
        for (let ri = 1; ri <= rowCount; ri++) {
            for (let ci = 1; ci <= colCount; ci++) {
                const cell = sheet.getCell(ri, ci);
                if (cell.text && cell.text.startsWith('=DISPIMG')) {
                    const match = cell.text.match(/^=DISPIMG\("(.+?)",\s*(\d+)\)/);
                    if (match) {
                        const imageId = match[1];
                        const mediaIndex = formulaImageMap[imageId];
                        const img = allSheetImages?.[0]?.[mediaIndex];

                        if (img && img.buffer) {
                            const cellInfo = dispimgStore.getImageCell(imageId);
                            if (!cellInfo) return;

                            const zoom = window.devicePixelRatio || 1;

                            let { left, top, width, height } = cellInfo;

                            left += position.x || 0;
                            top += position.y || 0;

                            // 加载图片
                            const bytes = new Uint8Array(img.buffer);
                            let binary = '';
                            bytes.forEach(b => binary += String.fromCharCode(b));
                            const base64 = btoa(binary);
                            const image = new Image();
                            image.src = `data:${img.type || 'image/png'};base64,${base64}`;
                            image.onload = function () {
                                const imgWidth = image.width;
                                const imgHeight = image.height;

                                // 单元格可用绘制区域（原始尺寸，不乘 zoom）
                                const cellWidth = width;
                                const cellHeight = height;

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
                            };
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.warn('[DISPIMG] render error:', err);
    }
}
let clipWidth = 60; //左侧序号列宽
let clipHeight = 25; //顶部序号行高
let defaultColWidth = 80;
let defaultRowHeight = 24;
let devicePixelRatio = window.devicePixelRatio;

function calcPosition(sheet, range, offset, options) {
    let {widthOffset, heightOffset} = options;
    let {tl, br, ext} = range;
    let {nativeCol = 0, nativeColOff = 0, nativeRow = 0, nativeRowOff = 0} = tl || {};

    let basicX = clipWidth;
    let basicY = clipHeight;
    for (let i = 0; i < nativeCol; i++) {
        basicX += sheet?._columns?.[i]?.width * 6 || defaultColWidth;
        basicX += widthOffset || 0;
    }
    for (let i = 0; i < nativeRow; i++) {
        basicY += sheet?._rows?.[i]?.height || defaultRowHeight;
        basicY += heightOffset || 0;
    }
    let x = basicX + nativeColOff / 12700;
    let y = basicY + nativeRowOff / 12700;

    let {
        nativeCol: nativeColEnd = 0,
        nativeColOff: nativeColOffEnd = 0,
        nativeRow: nativeRowEnd = 0,
        nativeRowOff: nativeRowOffEnd = 0
    } = br || {};
    let width = 0;
    if (nativeCol === nativeColEnd && br) {
        width = (nativeColOffEnd - nativeColOff) / 12700;
    } else if (br) {
        width = (sheet?._columns?.[nativeCol]?.width * 6 || defaultColWidth) - nativeColOff / 12700;

        for (let i = nativeCol + 1; i < nativeColEnd; i++) {
            width += sheet?._columns?.[i]?.width * 6 || defaultColWidth;
        }
        width += nativeColOffEnd / 12700;
    } else if (ext?.width) {
        width = ext.width / 1.333333;
    }
    let height;
    if (nativeRow === nativeRowEnd) {
        height = (nativeRowOffEnd - nativeRowOff) / 12700;
    } else if (br) {
        height = (sheet?._rows?.[nativeRow]?.height || defaultRowHeight) - nativeRowOff / 12700;
        for (let i = nativeRow + 1; i < nativeRowEnd; i++) {
            height += sheet?._rows?.[i]?.height || defaultRowHeight;
        }
        height += nativeRowOffEnd / 12700;
    } else if (ext?.height) {
        height = ext.height / 1.333333;
    }

    return {
        x: (x - (offset?.scroll?.x || 0)) * devicePixelRatio,
        y: (y - (offset?.scroll?.y || 0)) * devicePixelRatio,
        width: width * devicePixelRatio,
        height: height * devicePixelRatio
    };
}

export function clearCache() {
    cache = [];
}

function drawImage(ctx, index, data, position) {
    getImage(index, data).then(image => {
        let sx = 0;
        let sy = 0;
        let sWidth = image.width;
        let sHeight = image.height;
        let dx = position.x;
        let dy = position.y;
        let dWidth = position.width;
        let dHeight = position.height;
        let scaleX = dWidth / sWidth;
        let scaleY = dHeight / sHeight;

        if (dx < clipWidth * devicePixelRatio) {
            let diff = clipWidth * devicePixelRatio - dx;
            dx = clipWidth * devicePixelRatio;
            dWidth -= diff;
            sWidth -= diff / scaleX;
            sx += diff / scaleX;
        }
        if (dy < clipHeight * devicePixelRatio) {
            let diff = clipHeight * devicePixelRatio - dy;
            dy = clipHeight * devicePixelRatio;
            dHeight -= diff;
            sHeight -= diff / scaleY;
            sy += diff / scaleY;
        }
        // console.log('=>', sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
        let scale = window.outerWidth / window.innerWidth;
        ctx.drawImage(image, sx, sy, sWidth, sHeight, dx * scale, dy * scale, dWidth * scale, dHeight * scale);
    }).catch(e => {
        console.error(e);
    });
}

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
        image.onerror = function (e) {
            reject(e);
        };
    }));

}
