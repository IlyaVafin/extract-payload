import fs from 'fs';
function parseExperinceSDUI(content: string) {
  const startPosition = content.indexOf('0:[');
  if (startPosition === -1) {
    return;
  }
  const dataText = content.substring(startPosition);
  return dataText;
}

const content = fs.readFileSync('./experience.json', { encoding: 'utf-8' });
const result = parseExperinceSDUI(content.toString());
console.log(result);
