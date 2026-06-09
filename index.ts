import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import rateLimit from 'express-rate-limit'; // <- Nueva importación

const prisma = new PrismaClient();
const app = express();

app.use(cors()); 
app.use(express.json());

// --- CONFIGURACIÓN DE RATE LIMITER ---
// Máximo 5 intentos por IP cada 15 minutos
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos en milisegundos
  max: 5, // Límite de 5 peticiones por IP
  message: {
    error: 'Demasiados intentos de inicio de sesión. Por favor, inténtalo de nuevo en 15 minutos.'
  },
  standardHeaders: true, // Devuelve la información del límite en los headers `RateLimit-*`
  legacyHeaders: false, // Desactiva los headers antiguos `X-RateLimit-*`
});

// APLICAR EL LIMITADOR ÚNICAMENTE A LAS RUTAS CRÍTICAS
// Protegerá estos endpoints contra bots de fuerza bruta
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);
// -------------------------------------


// 1. CARGAR DASHBOARD (Con Paginación inicial de 10)
app.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const cuentas = await prisma.cuenta.findMany({
      orderBy: { nombre: 'asc' },
      include: { 
        transacciones: { 
          orderBy: { fecha: 'desc' },
          take: 10 // Solo carga los 10 más recientes
        } 
      }
    });
    res.json(cuentas);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// (Respaldo por si React llama a /cuentas en algún momento)
app.get('/cuentas', async (req: Request, res: Response) => {
  try {
    const cuentas = await prisma.cuenta.findMany({
      orderBy: { nombre: 'asc' },
      include: { 
        transacciones: { orderBy: { fecha: 'desc' }, take: 10 } 
      }
    });
    res.json(cuentas);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. CARGAR MÁS TRANSACCIONES (Botón Paginación)
app.get('/api/cuentas/:id/transacciones', async (req: Request, res: Response) => {
  const { id } = req.params;
  const skip = Number(req.query.skip) || 0; 
  const take = 10; 

  try {
    const nuevasTransacciones = await prisma.transaccion.findMany({
      where: { cuentaId: Number(id) },
      orderBy: { fecha: 'desc' },
      skip: skip,
      take: take
    });
    res.json(nuevasTransacciones);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. CREAR CUENTA
app.post('/cuentas', async (req: Request, res: Response) => {
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

// 4. REGISTRAR MOVIMIENTO 
app.post('/movimientos', async (req: Request, res: Response): Promise<any> => {
  const { cuentaId, tipo, monto, concepto, fecha } = req.body; 
  const valor = Number(monto);

  try {
    const cuenta = await prisma.cuenta.findUnique({ where: { id: Number(cuentaId) } });
    if (!cuenta) return res.status(404).json({ error: "Cuenta no encontrada" });

    let nuevoSaldo = cuenta.monto;
    
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

// 5. HISTORIAL COMPLETO PARA PDF/CSV
app.get('/cuentas/:id/historial', async (req: Request, res: Response): Promise<any> => {
  const { id } = req.params;
  try {
    const cuenta = await prisma.cuenta.findUnique({
      where: { id: Number(id) },
      include: { transacciones: { orderBy: { fecha: 'desc' } } } // Aquí sí traemos todas para el PDF
    });
    if (!cuenta) return res.status(404).json({ error: "No encontrado" });
    res.json(cuenta);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 6. EDITAR NOMBRE
app.put('/cuentas/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { nombre } = req.body;
  try {
    const editado = await prisma.cuenta.update({ where: { id: Number(id) }, data: { nombre } });
    res.json(editado);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7. ELIMINAR REGISTRO
app.delete('/cuentas/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.transaccion.deleteMany({ where: { cuentaId: Number(id) } });
    await prisma.cuenta.delete({ where: { id: Number(id) } });
    res.json({ message: "Eliminado" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// INICIO DEL SERVIDOR
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Backend corriendo en el puerto ${PORT}`));
