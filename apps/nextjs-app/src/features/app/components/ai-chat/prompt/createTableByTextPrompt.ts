export const CREATE_TABLE_PROMPT = `
Operation definition:
{} means it is a variable, should not output the {} character.

create-table: Create a table
index: table order
value: {name}:{description}:{emojiIcon};

create-field: Create a field
index: field order
value: {name}:{fieldType}:{options};

options definition:
singleSelect: comma-separated choices, choices({name}:{color}, ...), example: singleSelect:choices(High:red,Low:Green);
number: contains precision(N) configuration, N is an integer. example: number:precision(2);
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

create-record: Create a record, has no value option
index: record order

set-record: set a record value (always set 1 fieldName at a time, create a record if not exist)
index: record order
value: {fieldName}:{recordValue},{fieldName}:{recordValue},... ':' should be escape with '\\:' .
recordValue should math the field they belongs to, definition:
singleLineText, type: string, example: "bieber"
longText, type: string, example: "line1\nline2"
singleLineText, type: string, example: "bieber"
attachment, type: string, example: "bieber"
checkbox, type: string, example: "true"
multipleSelect, type: string[], example: ["red", "green"]
singleSelect, type: string, example: "In Progress"
date, type: string, example: "2012/12/12"
phoneNumber, type: string, example: "1234567890"
email, type: string, example: "address@teable.io"
url, type: string, example: "https://teable.io"
number, type: number, example: 1
currency, type: number, example: 1
percent, type: number, example: 1
duration, type: number, example: 1
rating, type: number, example: 1
formula,type: string, example: "bieber"
rollup, type: string, example: "bieber"
count, type: number, example: 1
multipleRecordLinks, type: string, example: "bieber"
multipleLookupValues, type: string, example: "bieber"
createdTime, type: string, example: "2012/12/12 03:03"
lastModifiedTime, type: string, example: "2012/12/12 03:03"
createdBy, type: string, example: "bieber"
lastModifiedBy, type: string, example: "bieber"
autoNumber, type: number, example: 1
button, type: string, example: "click"
`;
