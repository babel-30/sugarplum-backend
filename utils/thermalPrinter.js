module.exports = function sendToPrinter(commands) {
 if(process.env.PRINT_LOCAL_ENABLED!=="true")return Promise.reject(new Error("Local printer disabled"));
 const {SerialPort}=require('serialport');
 return new Promise((resolve,reject)=>{const port=new SerialPort({path:process.env.PRINTER_PORT||'COM3',baudRate:Number(process.env.PRINTER_BAUD||115200)});port.on('error',reject);port.on('open',()=>port.write(commands,e=>{if(e)return reject(e);port.drain(e=>{if(e)return reject(e);port.close(e=>e?reject(e):resolve(true));});}));});
};
