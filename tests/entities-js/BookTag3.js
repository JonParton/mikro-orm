const { Collection } = require('../../lib');
const { BaseEntity4 } = require('./index').BaseEntity4;

/**
 * @property {number} id
 * @property {string} name
 * @property {Collection<Book3>} books
 */
class BookTag3 extends BaseEntity4 {

  /**
   * @param {string} name
   */
  constructor(name) {
    super();
    this.name = name;
  }

}

const schema = {
  name: 'BookTag3',
  extends: 'BaseEntity4',
  properties: {
    name: 'string',
    books: {
      reference: 'm:n',
      owner: false,
      mappedBy: 'tags',
      type: 'Book3',
    },
  },
  path: __filename,
};

module.exports.BookTag3 = BookTag3;
module.exports.entity = BookTag3;
module.exports.schema = schema;
