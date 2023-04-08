import { Collection, Entity, ManyToOne, OneToMany, PrimaryKey, Property, wrap } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/sqlite';

@Entity()
class User {

  @PrimaryKey()
  id!: number;

  @Property()
  name!: string;

  @Property()
  email!: string;

  @OneToMany(() => Shop, shop => shop.owner)
  shop = new Collection<Shop>(this);

  @OneToMany(() => Product, product => product.owner)
  product = new Collection<Product>(this);

}

@Entity()
class Shop {

  @PrimaryKey()
  id!: number;

  @Property()
  name!: string;

  @OneToMany(() => Product, product => product.shop)
  products = new Collection<Product>(this);

  @ManyToOne(() => User)
  owner!: User;

}

@Entity()
export class Product {

  @PrimaryKey()
  id!: number;

  @Property()
  name!: string;

  @ManyToOne(() => Shop)
  shop!: Shop;

  @ManyToOne(() => User)
  owner!: User;

}

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    entities: [User, Shop, Product],
    dbName: ':memory:',
  });
  await orm.schema.refreshDatabase();
});

afterAll(() => orm.close());

beforeEach(async () => {
  orm.em.create(User, {
    name: 's1',
    email: 'sp-1@yopmail.com',
  });
  orm.em.create(User, {
    name: 'sp-2',
    email: 'sp-2@yopmail.com',
  });
  orm.em.create(Shop, {
    name: 'shop-1',
    owner: 1,
  });
  orm.em.create(Product, {
    name: 'product-1',
    shop: 1,
    owner: 1,
  });
  orm.em.create(Product, {
    name: 'product-2',
    shop: 1,
    owner: 2,
  });

  await orm.em.flush();
  orm.em.clear();
});

test('serialization', async () => {
  const [shop] = await orm.em.find(Shop, {}, {
    populate: ['products', 'owner'],
  });

  expect(wrap(shop).toObject()).toEqual({
    id: 1,
    name: 'shop-1',
    products: [
      { id: 1, name: 'product-1', shop: 1, owner: 1 },
      { id: 2, name: 'product-2', shop: 1, owner: 2 },
    ],
    owner: { id: 1, name: 's1', email: 'sp-1@yopmail.com' },
  });

  wrap(shop.owner).populated(false);
  expect(wrap(shop).toObject()).toEqual({
    id: 1,
    name: 'shop-1',
    products: [
      { id: 1, name: 'product-1', shop: 1, owner: 1 },
      { id: 2, name: 'product-2', shop: 1, owner: 2 },
    ],
    owner: 1,
  });

  wrap(shop.products).populated(false);
  expect(wrap(shop).toObject()).toEqual({
    id: 1,
    name: 'shop-1',
    products: [1, 2],
    owner: 1,
  });

  wrap(shop.products).populated();
  wrap(shop.owner).populated(); // populates both occurrences
  expect(wrap(shop).toObject()).toEqual({
    id: 1,
    name: 'shop-1',
    products: [
      { id: 1, name: 'product-1', shop: 1, owner: { id: 1, name: 's1', email: 'sp-1@yopmail.com' } },
      { id: 2, name: 'product-2', shop: 1, owner: 2 },
    ],
    owner: { id: 1, name: 's1', email: 'sp-1@yopmail.com' },
  });
});

