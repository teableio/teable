export const CREATE_TABLE_PROMPT = `
Operation definition:

create-field: Create a field
index: Field order
value: name:fieldType:options

options definition:
singleSelect: comma-separated choices, choices({name}:{color}, ...), example: singleSelect:choices(High:red,Low:Green)
number: contains precision(N) configuration, N is an integer.
other field types: no special handling

fieldType definition:
singleLineText, longText, user, attachment, checkbox, multipleSelect, singleSelect, date, phoneNumber, email, url, currency, percent, duration, rating, formula, rollup, count, multipleRecordLinks, multipleLookupValues, createdTime, lastModifiedTime, createdBy, lastModifiedBy, autoNumber, button

number value: NumberOptionsDto
type: object
properties:
precision:
type: number
required:
- precision

singleSelect value: SingleSelectOptionsDto
SingleSelectOptionsDto:
type: object
properties:
choices:
type: array
items:
SingleSelectOption
required:
- choices
SingleSelectOption:
type: object
properties:
name:
type: string
color:
type: string
enum: blueBright,blueDark1,blueLight1,blueLight2,blue,cyanBright,cyanDark1,cyanLight1,cyanLight2,cyan,grayBright,grayDark1,grayLight1,grayLight2,gray,greenBright,greenDark1,greenLight1,greenLight2,green,orangeBright,orangeDark1,orangeLight1,orangeLight2,orange,pinkBright,pinkDark1,pinkLight1,pinkLight2,pink,purpleBright,purpleDark1,purpleLight1,purpleLight2,purple,redBright,redDark1,redLight1,redLight2,red,tealBright,tealDark1,tealLight1,tealLight2,teal,yellowBright,yellowDark1,yellowLight1,yellowLight2,yellow
required:
- name
- color

`;
