// 这个模块是 Vue 2 / Vue 3 通用的
export const dispimgStore = {
    formulaImageMap: null,     // { "ID_XXXX": 0, "ID_YYYY": 1 }
    allSheetImages: null,      // [ [img1, img2, ...], [sheet2Img1, ...] ]
    imageCell: {},
    setFormulaMap(map) {
        this.formulaImageMap = map;
    },

    setAllSheetImages(images) {
        this.allSheetImages = images;
    },

    getFormulaMap() {
        return this.formulaImageMap;
    },

    getAllSheetImages() {
        return this.allSheetImages;
    },
    setImageCell(imgId, cell) {
        this.imageCell[imgId] = cell;
    },
    getImageCell(imgId) {
        return this.imageCell[imgId];
    },
};
