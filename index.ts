import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'secret_para_desarrollo_temporal_123';

app.use(cors());
app.use(express.json());

// Interfaz para extender la petición con los datos del usuario autenticado
interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
  };
}

// ==========================================
// MIDDLEWARE DE AUTENTICACIÓN
// ==========================================
const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
    return;
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET) as { id: number; email: string };
    req.user = verified;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Token inválido o expirado.' });
    return;
  }
};

// ==========================================
// RUTAS DE AUTENTICACIÓN (AUTH)
// ==========================================

// Registro de nuevos usuarios
app.post('/api/auth/signup', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Correo y contraseña son obligatorios.' });
      return;
    }

    // Verificar si el usuario ya existe
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
      return;
    }

    // Encriptar contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Crear usuario
    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    // Generar Token JWT de bienvenida
    const token = jwt.sign({ id: newUser.id, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'Usuario registrado con éxito',
      token,
      user: { id: newUser.id, email: newUser.email }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar el usuario.' });
  }
});

// Inicio de sesión (Login)
app.post('/api/auth/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Correo y contraseña son obligatorios.' });
      return;
    }

    // Buscar usuario
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(400).json({ error: 'Credenciales incorrectas.' });
      return;
    }

    // Validar contraseña
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      res.status(400).json({ error: 'Credenciales incorrectas.' });
      return;
    }

    // Generar Token JWT
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Inicio de sesión exitoso',
      token,
      user: { id: user.id, email: user.email }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

// Obtener datos del perfil actual
app.get('/api/auth/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ user: req.user });
});

// ==========================================
// RUTAS DE CUENTAS (PROTEGIDAS)
// ==========================================

// Obtener TODAS las cuentas exclusivas del usuario autenticado
app.get('/cuentas', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const cuentas = await prisma.cuenta.findMany({
      where: { userId }
    });
    res.json(cuentas);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las cuentas.' });
  }
});

// Obtener UNA cuenta específica con su historial (Exclusivo del usuario)
app.get('/cuentas/:id/historial', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const cuentaId = parseInt(req.params.id);

    const cuenta = await prisma.cuenta.findFirst({
      where: { id: cuentaId, userId },
      include: {
        transacciones: {
          orderBy: { fecha: 'desc' }
        }
      }
    });

    if (!cuenta) {
      res.status(404).json({ error: 'Cuenta no encontrada o acceso denegado.' });
      return;
    }

    res.json(cuenta);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener el historial.' });
  }
});

// Crear una nueva cuenta asignada al usuario
app.post('/cuentas', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { nombre, monto } = req.body;

    if (!nombre) {
      res.status(400).json({ error: 'El nombre de la cuenta es obligatorio.' });
      return;
    }

    const nuevaCuenta = await prisma.cuenta.create({
      data: {
        nombre,
        monto: monto ? parseFloat(monto) : 0,
        userId
      }
    });

    res.status(201).json(nuevaCuenta);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear la cuenta.' });
  }
});

// Actualizar el nombre de una cuenta del usuario
app.put('/cuentas/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const cuentaId = parseInt(req.params.id);
    const { nombre } = req.body;

    // Verificar propiedad
    const cuenta = await prisma.cuenta.findFirst({ where: { id: cuentaId, userId } });
    if (!cuenta) {
      res.status(403).json({ error: 'Acceso denegado.' });
      return;
    }

    const cuentaActualizada = await prisma.cuenta.update({
      where: { id: cuentaId },
      data: { nombre }
    });

    res.json(cuentaActualizada);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar la cuenta.' });
  }
});

// Eliminar una cuenta del usuario
app.delete('/cuentas/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const cuentaId = parseInt(req.params.id);

    // Verificar propiedad
    const cuenta = await prisma.cuenta.findFirst({ where: { id: cuentaId, userId } });
    if (!cuenta) {
      res.status(403).json({ error: 'Acceso denegado.' });
      return;
    }

    await prisma.cuenta.delete({
      where: { id: cuentaId }
    });

    res.json({ message: 'Cuenta eliminada con éxito.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar la cuenta.' });
  }
});

// ==========================================
// RUTAS DE MOVIMIENTOS / TRANSACCIONES
// ==========================================

// Crear transacción (movimiento) asociada a una cuenta del usuario
app.post('/movimientos', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { cuentaId, tipo, monto, concepto, fecha } = req.body;

    if (!tipo || !monto || !cuentaId) {
      res.status(400).json({ error: 'Tipo, monto y cuentaId son obligatorios.' });
      return;
    }

    // Validar que la cuenta le pertenece al usuario
    const cuenta = await prisma.cuenta.findFirst({
      where: { id: parseInt(cuentaId), userId }
    });

    if (!cuenta) {
      res.status(403).json({ error: 'No tienes permiso para operar en esta cuenta.' });
      return;
    }

    // Determinar si sumamos o restamos
    let nuevoMonto = cuenta.monto;
    if (tipo === 'Ingreso' || tipo === 'Abono') {
      nuevoMonto += parseFloat(monto);
    } else {
      nuevoMonto -= parseFloat(monto); // Gastos y Préstamos
    }

    // Usar transacción de Prisma para asegurar consistencia
    const [nuevaTransaccion] = await prisma.$transaction([
      prisma.transaccion.create({
        data: {
          tipo,
          monto: parseFloat(monto),
          concepto,
          cuentaId: parseInt(cuentaId),
          fecha: fecha ? new Date(fecha) : new Date() // Si viene fecha manual se asigna
        }
      }),
      prisma.cuenta.update({
        where: { id: parseInt(cuentaId) },
        data: { monto: nuevoMonto }
      })
    ]);

    res.status(201).json(nuevaTransaccion);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar el movimiento.' });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor Multi-usuario activo en el puerto ${PORT}`);
});
