export const GENERATE_CHART_PROMPT = `
Operation definition:

generate-chart: Generate a chart
index: Chart type array index
value: options

Chart type array index definition:
here is an array of chart types: ['bar', 'pie', 'line']
chart type array index means to return the subscript of the chart type,  e.g. I need to generate a pie then it will return 1
default index is 0

options definition:
For creating charts with ECharts
type: object
descript: An object containing data for a chart, including x-axis data, series data, and the statistical method.
properties:
  xAxis:
    type: object
    description: The x-axis data.
    properties:
      fieldName:
        type: string
        description: The field name for the x-axis data.
  series:
    type: array
    description: The series data.
    items:
      type: object
      properties:
        fieldName:
          type: string
          description: The field name for this series data.
  statistic:
    type: string
    description: The statistical method, which can be Sum or Count.
    enum:
      - Sum
      - Count
required:
  - xAxis
  - series
  - statistic

`;
