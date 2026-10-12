/**
 * Calque des poignées de l'éditeur de plan : vide au sous-lot 4a, placé au-dessus des autres
 * calques ; il recevra au 4b les poignées de l'escalier et de la cage (positions lues dans le
 * `Model`).
 */
export function HandleLayer() {
  return <g className="plan-editor__layer plan-editor__layer--handles" />;
}
