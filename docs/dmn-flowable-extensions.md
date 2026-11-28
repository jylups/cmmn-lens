# Flowable extensions in DMN files

What Flowable writes into DMN files beyond the standard, and what the viewer needs for them (issue #55).

## What Flowable reads and writes

Flowable's DMN engine (`flowable-dmn-xml-converter`) reads DMN 1.1 (`http://www.omg.org/spec/DMN/20151101/dmn.xsd`), DMN 1.2 (`http://www.omg.org/spec/DMN/20180521/MODEL/`) and DMN 1.3 (`https://www.omg.org/spec/DMN/20191111/MODEL/`), checking each against its own schema. It writes DMN 1.3, with DMNDI for the decision requirements diagram.

Its own namespace is `http://flowable.org/dmn` (prefix `flowable`). The converter reads one attribute in it:

| Attribute | On | Meaning |
| --- | --- | --- |
| `flowable:forceDMN11` | `decision` | evaluate the decision table with DMN 1.1 semantics (`"true"`) |

Every other attribute and extension element is kept as it is, without a type: the converter reads unknown attributes as extension attributes and `<extensionElements>` children as generic extension elements, and writes them back.

Flowable Design also writes its own extension elements in the `http://flowable.org/design` namespace (prefix `design`), for example a tag on the definitions. The engine doesn't read them.

Decision tables use the standard elements: `inputExpression` and input and output entries hold the expression text, in JUEL or Flowable's expression language as the engine evaluates it, with `typeRef` on inputs and outputs and `hitPolicy` (and `aggregation` for COLLECT) on the table.

## What the viewer does

- **No moddle descriptor is needed.** dmn-moddle keeps attributes and extension elements in namespaces it doesn't know (`flowable`, `design`) on the element (`$attrs`, and generic elements under `extensionElements`), without warnings, and writes them back when the editor saves. `get_selection` reports `flowable:forceDMN11` as an attribute.
- **DMN 1.1 and 1.2 files** are migrated to DMN 1.3 when read (`@bpmn-io/dmn-migrate`, as dmn-js does on import), so the tools and the viewer read them like DMN 1.3. Saving from the editor writes DMN 1.3, which Flowable reads.
- **`.xml` files** are recognised by any of the three DMN namespaces on their root element.

A descriptor would only be needed if Flowable added typed extensions that the viewer or editor should show or edit; none exist today, so no issue was opened for one.
