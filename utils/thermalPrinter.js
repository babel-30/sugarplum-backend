const { SerialPort } = require("serialport");

const COM_PORT = "COM3";
const BAUD_RATE = 115200;

function sendToPrinter(rawCommands) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort(
      {
        path: COM_PORT,
        baudRate: BAUD_RATE,
      },
      (err) => {
        if (err) {
          console.error("Error opening COM port:", err);
          return reject(err);
        }
      }
    );

    port.on("open", () => {
      console.log("COM3 opened. Sending print job...");
      port.write(rawCommands, (err) => {
        if (err) {
          console.error("write error:", err);
          return reject(err);
        }
        console.log("Print data sent.");
        port.close();
        resolve(true);
      });
    });

    port.on("error", (err) => {
      console.error("Serial port error:", err);
      reject(err);
    });
  });
}

module.exports = sendToPrinter;
