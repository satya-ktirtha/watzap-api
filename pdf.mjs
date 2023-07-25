import PDFDocument from 'pdfkit';
import fs from 'fs';

// TODO NEXT PAGE WHEN FULL
class State {
    constructor(doc) {
        if(!(doc instanceof PDFDocumentWithTable)) {
            throw new Error('Argument must be an instance of PDFDocumentWithTable');
        }

        this.doc = doc;
        this.formats = {};
        this.headerFormat = {}
    }

    handleRows() {
        throw new Error("Must be overriden in subclasses");
    }

    handleHeaders() {
        throw new Error("Must be overriden in subclasses");
    }

    handle() {
        const startingX = this.doc.x;
        const startingY = this.doc.y;

        this.doc.fontSize(9);

        if(!this.doc.tableOptions.reversed) {
            for(const { header, options: hOptions } of this.doc.headers) {
                const headerOptions = Object.assign(JSON.parse(JSON.stringify(this.doc.defaultHeaderOptions)), hOptions);
                const headerPadding = headerOptions.padding;
                const headerWidth = this.doc.widthOfString(header);
                const headerHeight = this.doc.heightOfString(header);

                this.headerFormat[header] = {
                    padding: headerPadding,
                    width: headerWidth,
                    height: headerHeight
                }

                if(!this.doc.tableOptions.reversed && headerOptions.width) {
                    this.headerFormat[header].width = headerOptions.width || headerWidth
                    continue;
                }

                for(const { data, options: cOptions } of this.doc.rows) {
                    const cellOptions = Object.assign(JSON.parse(JSON.stringify(this.doc.defaultCellOptions)), cOptions);
                    const cellPadding = cellOptions.padding;
                    const cellWidth = this.doc.widthOfString(data[header.toLowerCase()]);
                    const cellTotalWidth = cellPadding.left + cellWidth + cellPadding.right;

                    const maxTotalWidth = this.headerFormat[header].padding.left + this.headerFormat[header].width + this.headerFormat[header].padding.right;

                    if(cellTotalWidth > maxTotalWidth) {
                        this.headerFormat[header].padding = cellPadding;
                        this.headerFormat[header].width = cellWidth;
                    }
                }
            }
        } else {
            let maxPadding = {
                top: 0,
                bottom: 0,
                left: 0,
                right: 0
            };
            let maxWidth = 0;
            for(const { header, options: hOptions } of this.doc.headers) {
                const headerOptions = Object.assign(JSON.parse(JSON.stringify(this.doc.defaultHeaderOptions)), hOptions);
                const headerPadding = headerOptions.padding;
                const headerWidth = this.doc.widthOfString(header);
                const headerHeight = this.doc.heightOfString(header);

                this.headerFormat[header] = {
                    padding: headerPadding,
                    width: headerWidth,
                    height: headerHeight
                }

                if(headerPadding.left + headerWidth + headerPadding.right > maxPadding.left + maxWidth + maxPadding.right) {
                    maxWidth = headerWidth;
                    maxPadding = headerPadding;
                    for(const key of Object.keys(this.headerFormat)) {
                        this.headerFormat[key].padding = headerPadding;
                        this.headerFormat[key].width = headerWidth;
                    }
                } else {
                    this.headerFormat[header].padding = maxPadding;
                    this.headerFormat[header].width = maxWidth;
                }
            }
        }

        this.handleHeaders();
        this.handleRows();

        this.doc.x = startingX;
        this.doc.y += this.totalHeight;
    }
}

class ComplexState extends State {
    constructor(doc) {
        super(doc);

        this.totalHeight = 0;
    }

    handleRows() {
        const startingX = this.doc.x;
        const startingY = this.doc.y;

        let closingWidth = 0;
        let closingHeight = 0;
        for(const { header } of this.doc.headers) {
            const format = this.headerFormat[header];
            closingWidth += format.padding.left + format.width + format.padding.right;
            closingHeight += format.padding.top + format.height + format.padding.bottom;
        }

        for(const { data, options: cOptions } of this.doc.rows) {
            // TODO hardcoded A4 size
            if(this.doc.y > 595.28 - this.doc.options.margins.bottom) {
                this.doc.addPage();
                this.doc.x = startingX;
            }

            const cellOptions = Object.assign(JSON.parse(JSON.stringify(this.doc.defaultCellOptions)), cOptions);
            let totalMaxHeight = 0;
            let totalMaxWidth = 0;
            let maxPadding = {
                top: 0,
                bottom: 0,
                left: 0,
                right: 0
            };
            let maxWidth = 0;

            if(this.doc.tableOptions.reversed && cOptions && cOptions.width) {
                maxPadding = cellOptions.padding;
                maxWidth = cOptions.width;
            } else {
                for(const { header } of this.doc.headers) {
                    const width = this.doc.widthOfString(data[header.toLowerCase()]);
                    if(cellOptions.padding.left + width + cellOptions.padding.right > maxPadding.left + maxWidth + maxPadding.right) {
                        maxPadding = cellOptions.padding;
                        maxWidth = width;
                    }
                }
            }

            let format = {
                padding: maxPadding,
                width: maxWidth
            }

            for(const { header, options: hOptions } of this.doc.headers) {
                const headerOptions = Object.assign(JSON.parse(JSON.stringify(this.doc.defaultHeaderOptions)), hOptions);

                if(!this.doc.tableOptions.reversed) {
                    format = this.headerFormat[header];
                } else {
                    format.height = this.doc.heightOfString(header);
                }

                if(format.padding.top + format.height + format.padding.bottom > totalMaxHeight) {
                    totalMaxHeight = format.padding.top + format.height + format.padding.bottom;
                }

                if(format.padding.left + format.width + format.padding.right > totalMaxWidth) {
                    totalMaxWidth = format.padding.left + format.width + format.padding.right;
                }

                // horizontal line (top)
                this.doc.moveTo(this.doc.x, this.doc.y)
                        .lineTo(this.doc.x + format.padding.left + format.width + format.padding.right, this.doc.y)
                        .stroke();

                // vertical line (left)
                this.doc.moveTo(this.doc.x, this.doc.y)
                        .lineTo(this.doc.x, this.doc.y + format.padding.top + format.height + format.padding.bottom)
                        .stroke();


                this.doc.x += format.padding.left;
                this.doc.y += format.padding.top;
                this.doc.text(data[header.toLowerCase()].toLowerCase(), {
                    width: format.width,
                    height: format.height,
                    align: cellOptions.align
                })
                if(!this.doc.tableOptions.reversed) {
                    this.doc.x += format.width + format.padding.right;
                    this.doc.y -= (format.height + format.padding.top);
                } else {
                    this.doc.x -= (format.padding.left);
                    this.doc.y += format.padding.bottom;
                }
            }
            
            if(!this.doc.tableOptions.reversed) {
                this.doc.moveTo(this.doc.x, this.doc.y)
                        .lineTo(this.doc.x, this.doc.y + totalMaxHeight)
                        .stroke();

                this.doc.x = startingX;
                this.doc.y += totalMaxHeight;
            } else {
                this.doc.moveTo(this.doc.x, this.doc.y)
                        .lineTo(this.doc.x + totalMaxWidth, this.doc.y)
                        .stroke();

                this.doc.x += totalMaxWidth; 
                this.doc.y = startingY;
            }
        }

        if(!this.doc.tableOptions.reversed) {
            this.doc.moveTo(startingX, this.doc.y)
                    .lineTo(startingX + closingWidth, this.doc.y)
                    .stroke();
        } else {
            this.doc.moveTo(this.doc.x, startingY)
                    .lineTo(this.doc.x, startingY + closingHeight)
                    .stroke();
        }

        this.totalHeight += closingHeight;
    }

    handleHeaders() {
        const startingX = this.doc.x;
        const startingY = this.doc.y;

        let totalMaxHeight = 0;
        let totalMaxWidth = 0;

        for(const { header, options: hOptions} of this.doc.headers) {
            const headerOptions = Object.assign(JSON.parse(JSON.stringify(this.doc.defaultHeaderOptions)), hOptions);
            //const format = this.formats[header];
            const format = this.headerFormat[header];

            if(format.padding.top + format.height + format.padding.bottom > totalMaxHeight) {
                totalMaxHeight = format.padding.top + format.height + format.padding.bottom;
            }

            if(format.padding.left + format.width + format.padding.right > totalMaxWidth) {
                totalMaxWidth = format.padding.left + format.width + format.padding.right;
            }

            // background color
            this.doc.rect(this.doc.x, this.doc.y, format.padding.left + format.width + format.padding.right, format.padding.top + format.height + format.padding.bottom)
                    .fill(headerOptions.background);
            this.doc.fillColor('black');

            // vertical lines (left)
            this.doc.lineCap('square').lineJoin('miter');
            this.doc.moveTo(this.doc.x, this.doc.y)
                    .lineTo(this.doc.x, this.doc.y + format.padding.top + format.height + format.padding.bottom)
                    .stroke();

            // horizontal lines (top)
            this.doc.moveTo(this.doc.x, this.doc.y)
                    .lineTo(this.doc.x + format.padding.left + format.width + format.padding.right, this.doc.y)
                    .stroke();

            this.doc.x += format.padding.left;
            this.doc.y += format.padding.top;
            this.doc.text(header, {
                width: format.width,
                height: format.height,
                align: headerOptions.align
            });
            if(!this.doc.tableOptions.reversed) {
                this.doc.x += format.width + format.padding.right;
                this.doc.y -= (format.padding.top + format.height);
            } else {
                this.doc.x -= (format.padding.left);
                this.doc.y += format.padding.bottom;
            }

        }

        if(!this.doc.tableOptions.reversed) {
            this.doc.moveTo(this.doc.x, this.doc.y)
                    .lineTo(this.doc.x, this.doc.y + totalMaxHeight)
                    .stroke();

            this.doc.x = startingX;
            this.doc.y += totalMaxHeight;
        } else {
            this.doc.moveTo(this.doc.x, this.doc.y)
                    .lineTo(this.doc.x + totalMaxWidth, this.doc.y)
                    .stroke();

            this.doc.x += totalMaxWidth;
            this.doc.y = startingY;
        }

        this.totalHeight += totalMaxHeight;
    }
}

class PDFDocumentWithTable extends PDFDocument {
    constructor(options) {
        super(options);

        this.defaultCellOptions = {
            fontSize: 5,
            align: 'left',
            width: undefined,
            height: undefined,
            padding: {
                top: 5,
                bottom: 5,
                left: 5,
                right: 5
            }
        }

        this.defaultTableOptions = {
            hideHeaders: false,
            reversed: false
        }

        this.defaultHeaderOptions = {
            fontSize: 10,
            align: 'left',
            width: undefined,
            height: undefined,
            padding: {
                top: 5,
                bottom: 5,
                left: 5,
                right: 5
            },
            background: 'gray'
        }
    }

    table(data, tOptions) {
        if((!data.complex || data.simple) && (data.complex || !data.simple)) {
            throw new Error("Use either complex or simple");
        }

        this.x = tOptions.x || this.x;
        this.y = tOptions.y || this.y;

        if(data.complex) {
            this.state = new ComplexState(this);
        } else if(data.simple) {
            this.state = new SimpleState(this);
        }

        this.tableOptions = Object.assign(JSON.parse(JSON.stringify(this.defaultTableOptions)), tOptions);

        this.headers = (data.complex.headers || data.simple.headers) || [];
        this.rows = (data.complex.rows || data.simple.rows) || [];

        this.state.handle();
    }
}

/**
 * Example to create tables
const doc = new PDFDocumentWithTable({
    size: 'A4', // 595.28 x 841.89
    layout: 'landscape',
    margins: {
        top: 20,
        bottom: 20,
        left: 20,
        right: 20
    }
});

doc.pipe(fs.createWriteStream('test.pdf'));

const manifestData = {
    complex: {
        headers: [
            { header: 'Manifest' },
            { header: 'Created' },
            { header: 'ETA' },
            { header: 'Total quantity' },
            { header: 'Total Weight' }
        ],
        rows: [
            {
                data: {
                    manifest: 'JKTJKT123091001',
                    created: 'Satya / 18 Aug 2023',
                    eta: '19 Sep 2023',
                    'total quantity': '23',
                    'total weight': '24 kg'
                }
            }
        ]
    }
}

const sttData = {
    complex: {
        headers: [
            { header: 'STT' },
            { header: 'Pengirim' },
            { header: 'POL' },
            { header: 'POD' },
            { header: 'Komoditi' },
            { header: 'Penerima' },
            { header: 'QTY' },
            { header: 'AWT' }
        ],
        rows: [
            { 
                data: {
                    stt: '1',
                    pengirim: '1peng',
                    pol: '1pol',
                    pod: '1pod',
                    komoditi: '1komoditi',
                    penerima: '1penerima',
                    qty: '1qty',
                    awt: '1awt'
                }
            },
            { 
                data: {
                    stt: '1',
                    pengirim: '1peng',
                    pol: '1pol',
                    pod: '1pod',
                    komoditi: '1komoditi',
                    penerima: '1penerima',
                    qty: '1qty',
                    awt: '1awt'
                }
            },
            { 
                data: {
                    stt: '1',
                    pengirim: '1peng',
                    pol: '1pol',
                    pod: '1pod',
                    komoditi: '1komoditi',
                    penerima: '1penerima',
                    qty: '1qty',
                    awt: '1awt'
                }
            }
        ]
    }
};

const options = {
    reversed: true
};

doc.table(manifestData, {reversed: true});
doc.table(sttData, {reversed: false});

doc.end();
*/

export default PDFDocumentWithTable;
