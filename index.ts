import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';

const prisma = new PrismaClient();
const app = express();

app.use(cors()); 
app.use(express.json());

// 1. LISTAR CUENTAS
app.get('/cuentas', async (req, res) => {
  try {
    const cuentas = await prisma.cuenta.findMany();
    res.json(cuentas);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. CREAR CUENTA
app.post('/cuentas', async (req, res) => {
  const { nombre, monto } = req.body;
  try {
    const nuevaCuenta = await prisma.cuenta.create({
      data: { nombre, monto: Number(monto) }
    });
    res.status(201).json(nuevaCuenta);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. REGISTRAR MOVIMIENTO (Lógica de sumas y restas)
app.post('/movimientos', async (req, res) => {
  const { cuentaId, tipo, monto, concepto, fecha } = req.body; 
  const valor = Number(monto);

  try {
    const cuenta = await prisma.cuenta.findUnique({ where: { id: Number(cuentaId) } });
    if (!cuenta) return res.status(404).json({ error: "Usuario no encontrado" });

    let nuevoSaldo = cuenta.monto;
    
    // Préstamos y Gastos SUMAN al balance (deuda o gasto acumulado)
    // Ingresos y Abonos RESTAN al balance (reducen la deuda o aumentan el saldo a favor)
    const aumenta = ["Préstamo", "Gasto", "Pago de servicio"].includes(tipo);
    const disminuye = ["Ingreso", "Abono", "Adelanto", "Pago de nómina"].includes(tipo);

    if (aumenta) {
      nuevoSaldo += valor;
    } else if (disminuye) {
      nuevoSaldo -= valor;
    }

    const datosTransaccion: any = { tipo, monto: valor, cuentaId: Number(cuentaId) };
    if (concepto) datosTransaccion.concepto = concepto;
    if (fecha) datosTransaccion.fecha = new Date(fecha); 

    const resultado = await prisma.$transaction([
      prisma.transaccion.create({ data: datosTransaccion }),
      prisma.cuenta.update({
        where: { id: Number(cuentaId) },
        data: { monto: nuevoSaldo }
      })
    ]);

    res.json(resultado);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. HISTORIAL PARA PDF
app.get('/cuentas/:id/historial', async (req, res) => {
  const { id } = req.params;
  try {
    const cuenta = await prisma.cuenta.findUnique({
      where: { id: Number(id) },
      // Añadido { id: 'desc' } para asegurar el orden cuando las fechas sean idénticas
      include: { transacciones: { orderBy: [{ fecha: 'desc' }, { id: 'desc' }] } }
    });
    if (!cuenta) return res.status(404).json({ error: "No encontrado" });
    res.json(cuenta);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. EDITAR NOMBRE
app.put('/cuentas/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;
  try {
    const editado = await prisma.cuenta.update({ where: { id: Number(id) }, data: { nombre } });
    res.json(editado);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 6. ELIMINAR REGISTRO
app.delete('/cuentas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.transaccion.deleteMany({ where: { cuentaId: Number(id) } });
    await prisma.cuenta.delete({ where: { id: Number(id) } });
    res.json({ message: "Eliminado" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3001, () => console.log('🚀 Backend en http://localhost:3001'));