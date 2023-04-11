/* eslint-disable @typescript-eslint/naming-convention */
export const preCode = `
  import _React from 'react';
  import _ReactDOM from 'react-dom';
  `;
export const templateHtml = `
  <html>
    <head>
      <style type="text/css">
        html, body, #root {
          height: 100%;
        }
      </style>
    </head>
    <body>
      <div id="root"></div>
      <script>
        const handleError = (err) => {
          const root = document.querySelector('#root');
          root.innerHTML = '<div style="color: red; font-family: Arial, Helvetica, sans-serif;"><h4>Runtime Error</h4>' + err + '</div>';
          console.error(err);
        };

        // async error
        window.addEventListener('error', (event) => {
          event.preventDefault();
          handleError(event.error);
        });

        window.addEventListener('message', (event) => {
          try {
            eval(event.data);
          } catch (err) {
            handleError(err);
          }
        }, false);
      </script>
    </body>
  </html>
`;
