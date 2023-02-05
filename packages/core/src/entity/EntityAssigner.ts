import { inspect } from 'util';
import type { Collection } from './Collection';
import type { EntityManager } from '../EntityManager';
import type {
  AnyEntity,
  Dictionary,
  EntityData,
  EntityDTO,
  EntityMetadata,
  EntityProperty, EntityValue,
  Primary,
  RequiredEntityData,
} from '../typings';
import { Utils } from '../utils/Utils';
import { Reference } from './Reference';
import { ReferenceKind, SCALAR_TYPES } from '../enums';
import { EntityValidator } from './EntityValidator';
import { helper, wrap } from './wrap';

const validator = new EntityValidator(false);

export class EntityAssigner {

  static assign<T extends object>(entity: T, data: EntityData<T> | Partial<EntityDTO<T>>, options: AssignOptions = {}): T {
    if (options.visited?.has(entity)) {
      return entity;
    }

    options.visited ??= new Set();
    options.visited.add(entity);
    const wrapped = helper(entity);
    options = {
      updateNestedEntities: true,
      updateByPrimaryKey: true,
      mergeObjectProperties: true,
      schema: wrapped.__schema,
      ...options, // allow overriding the defaults
    };
    const meta = wrapped.__meta;
    const em = options.em || wrapped.__em;
    const props = meta.properties;

    Utils.keys(data).forEach(prop => {
      if (options.onlyProperties && !(prop in props)) {
        return;
      }

      let value = data[prop];

      if (props[prop] && !props[prop].nullable && value == null) {
        throw new Error(`You must pass a non-${value} value to the property ${prop} of entity ${(entity as Dictionary).constructor.name}.`);
      }

      if (props[prop] && Utils.isCollection(entity[prop as keyof T])) {
        return EntityAssigner.assignCollection<T>(entity, entity[prop as keyof T] as unknown as Collection<AnyEntity>, value, props[prop], em, options);
      }

      const customType = props[prop]?.customType;

      if (options.convertCustomTypes && customType && props[prop].kind === ReferenceKind.SCALAR && !Utils.isEntity(data)) {
        value = props[prop].customType.convertToJSValue(value, wrapped.__platform);
      }

      if ([ReferenceKind.MANY_TO_ONE, ReferenceKind.ONE_TO_ONE].includes(props[prop]?.kind) && value != null) {
        // eslint-disable-next-line no-prototype-builtins
        if (options.updateNestedEntities && (entity as object).hasOwnProperty(prop) && Utils.isEntity(entity[prop], true) && Utils.isPlainObject(value)) {
          const unwrappedEntity = Reference.unwrapReference(entity[prop]!);

          if (options.updateByPrimaryKey) {
            const pk = Utils.extractPK(value, props[prop].targetMeta);

            if (pk) {
              const ref = em.getReference(props[prop].type, pk as Primary<T>, options);
              // if the PK differs, we want to change the target entity, not update it
              const sameTarget = ref.__helper.getSerializedPrimaryKey() === helper(unwrappedEntity).getSerializedPrimaryKey();

              if (ref.__helper!.isInitialized() && sameTarget) {
                return EntityAssigner.assign(ref, value, options);
              }
            }

            return EntityAssigner.assignReference<T>(entity, value, props[prop], em!, options);
          }

          if (wrap(unwrappedEntity).isInitialized()) {
            return EntityAssigner.assign(unwrappedEntity, value, options);
          }
        }

        return EntityAssigner.assignReference<T>(entity, value, props[prop], em, options);
      }

      if (props[prop]?.kind === ReferenceKind.SCALAR && SCALAR_TYPES.includes(props[prop].type) && (props[prop].setter || !props[prop].getter)) {
        return entity[prop as keyof T] = validator.validateProperty(props[prop], value, entity);
      }

      if (props[prop]?.kind === ReferenceKind.EMBEDDED && EntityAssigner.validateEM(em)) {
        return EntityAssigner.assignEmbeddable(entity, value, props[prop], em, options);
      }

      if (options.mergeObjectProperties && Utils.isPlainObject(value)) {
        entity[prop] ??= {} as EntityValue<T>;
        Utils.merge(entity[prop], value);
      } else if (!props[prop] || props[prop].setter || !props[prop].getter) {
        entity[prop] = value as EntityValue<T>;
      }
    });

    return entity;
  }

  /**
   * auto-wire 1:1 inverse side with owner as in no-sql drivers it can't be joined
   * also makes sure the link is bidirectional when creating new entities from nested structures
   * @internal
   */
  static autoWireOneToOne<T extends object>(prop: EntityProperty<T>, entity: T): void {
    const ref = entity[prop.name] as T;

    if (prop.kind !== ReferenceKind.ONE_TO_ONE || !Utils.isEntity(ref)) {
      return;
    }

    const meta2 = helper(ref).__meta;
    const prop2 = meta2.properties[prop.inversedBy || prop.mappedBy] as EntityProperty<T>;

    /* istanbul ignore next */
    if (prop2 && !ref![prop2.name]) {
      if (Reference.isReference<T>(ref)) {
        ref.unwrap()[prop2.name] = Reference.wrapReference(entity, prop2) as EntityValue<T>;
      } else {
        ref[prop2.name] = Reference.wrapReference(entity, prop2) as EntityValue<T>;
      }
    }
  }

  private static validateEM(em?: EntityManager): em is EntityManager {
    if (!em) {
      throw new Error(`To use assign() on not managed entities, explicitly provide EM instance: wrap(entity).assign(data, { em: orm.em })`);
    }

    return true;
  }

  private static assignReference<T extends object>(entity: T, value: any, prop: EntityProperty<T>, em: EntityManager | undefined, options: AssignOptions): void {
    if (Utils.isEntity(value, true)) {
      entity[prop.name] = Reference.wrapReference(value as T, prop) as EntityValue<T>;
    } else if (Utils.isPrimaryKey(value, true) && EntityAssigner.validateEM(em)) {
      entity[prop.name] = prop.mapToPk ? value as EntityValue<T> : Reference.wrapReference(em.getReference<T>(prop.type, value as Primary<T>, options), prop) as EntityValue<T>;
    } else if (Utils.isPlainObject(value) && options.merge && EntityAssigner.validateEM(em)) {
      entity[prop.name] = Reference.wrapReference(em.merge(prop.type, value as T, options) as T, prop) as EntityValue<T>;
    } else if (Utils.isPlainObject(value) && EntityAssigner.validateEM(em)) {
      entity[prop.name] = Reference.wrapReference(em.create(prop.type, value as T, options) as T, prop) as EntityValue<T>;
    } else {
      const name = (entity as object).constructor.name;
      throw new Error(`Invalid reference value provided for '${name}.${prop.name}' in ${name}.assign(): ${JSON.stringify(value)}`);
    }

    EntityAssigner.autoWireOneToOne(prop, entity);
  }

  private static assignCollection<T extends object, U extends object = AnyEntity>(entity: T, collection: Collection<U>, value: unknown, prop: EntityProperty, em: EntityManager | undefined, options: AssignOptions): void {
    const invalid: any[] = [];
    const items = Utils.asArray(value).map((item: any, idx) => {
      // try to propagate missing owning side reference to the payload first
      const prop2 = prop.targetMeta?.properties[prop.mappedBy];

      if (Utils.isPlainObject(item) && prop2 && item[prop2.name] == null) {
        item = { ...item, [prop2.name]: Reference.wrapReference(entity, prop2) };
      }

      if (options.updateNestedEntities && options.updateByPrimaryKey && Utils.isPlainObject(item)) {
        const pk = Utils.extractPK(item, prop.targetMeta);

        if (pk && EntityAssigner.validateEM(em)) {
          const ref = em.getUnitOfWork().getById(prop.type, pk as Primary<U>, options.schema);

          /* istanbul ignore else */
          if (ref) {
            return EntityAssigner.assign(ref, item as U, options);
          }
        }

        return this.createCollectionItem<U>(item, em, prop, invalid, options);
      }

      /* istanbul ignore next */
      if (options.updateNestedEntities && !options.updateByPrimaryKey && helper(collection[idx])?.isInitialized()) {
        return EntityAssigner.assign(collection[idx], item, options);
      }

      return this.createCollectionItem<U>(item, em, prop, invalid, options);
    });

    if (invalid.length > 0) {
      const name = (entity as object).constructor.name;
      throw new Error(`Invalid collection values provided for '${name}.${prop.name}' in ${name}.assign(): ${inspect(invalid)}`);
    }

    if (Array.isArray(value)) {
      collection.set(items);
    } else { // append to the collection in case of assigning a single value instead of array
      collection.add(items);
    }
  }

  private static assignEmbeddable<T extends object>(entity: T, value: any, prop: EntityProperty<T>, em: EntityManager | undefined, options: AssignOptions): void {
    const propName = prop.embedded ? prop.embedded[1] : prop.name;

    if (!value) {
      entity[propName] = value;
      return;
    }

    // if the value is not an array, we just push, otherwise we replace the array
    if (prop.array && (Array.isArray(value) || entity[propName] == null)) {
      entity[propName] = [] as EntityValue<T>;
    }

    if (prop.array) {
      return Utils.asArray(value).forEach(item => {
        const tmp = {} as T;
        this.assignEmbeddable(tmp, item, { ...prop, array: false }, em, options);
        (entity[propName] as unknown[]).push(...Object.values(tmp));
      });
    }

    const create = () => EntityAssigner.validateEM(em) && em!.getEntityFactory().createEmbeddable<T>(prop.type, value, {
      convertCustomTypes: options.convertCustomTypes,
      newEntity: options.mergeObjectProperties ? !entity[propName] : true,
    });
    entity[propName] = (options.mergeObjectProperties ? (entity[propName] || create()) : create()) as EntityValue<T>;

    Object.keys(value).forEach(key => {
      const childProp = prop.embeddedProps[key];

      if (childProp && childProp.kind === ReferenceKind.EMBEDDED) {
        return EntityAssigner.assignEmbeddable(entity[propName], value[key], childProp, em, options);
      }

      (entity[propName] as Dictionary)[key] = value[key];
    });
  }

  private static createCollectionItem<T extends object>(item: any, em: EntityManager | undefined, prop: EntityProperty, invalid: any[], options: AssignOptions): T {
    if (Utils.isEntity<T>(item)) {
      return item;
    }

    if (Utils.isPrimaryKey(item) && EntityAssigner.validateEM(em)) {
      return em.getReference(prop.type, item, options) as T;
    }

    if (Utils.isPlainObject(item) && options.merge && EntityAssigner.validateEM(em)) {
      return em.merge<T>(prop.type, item as EntityData<T>, options);
    }

    if (Utils.isPlainObject(item) && EntityAssigner.validateEM(em)) {
      return em.create<T>(prop.type, item as RequiredEntityData<T>, options);
    }

    invalid.push(item);

    return item as T;
  }

}

export const assign = EntityAssigner.assign;

export interface AssignOptions {
  updateNestedEntities?: boolean;
  updateByPrimaryKey?: boolean;
  onlyProperties?: boolean;
  convertCustomTypes?: boolean;
  mergeObjectProperties?: boolean;
  merge?: boolean;
  schema?: string;
  em?: EntityManager;
  /** @internal */
  visited?: Set<AnyEntity>;
}
